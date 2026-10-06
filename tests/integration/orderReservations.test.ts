import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, cancelOrder, deleteOrder, addOrderItems, updateOrderItem, removeOrderItem, updateOrderItemStatus } from '@/actions/orders'
import { createProductionRun } from '@/actions/productionRuns'
import { reconcileAllPendingOrders } from '@/lib/orderReservations'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  // updateOrderItemStatus(ENTREGUE) cria uma Sale de verdade -- precisa
  // sumir antes do Product (FK Sale_productId_fkey), mesmo motivo de
  // qualquer outro teste de integração que passa por esse caminho.
  await prisma.sale.deleteMany()
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productPartFilament.deleteMany()
  await prisma.productPart.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
}

beforeAll(async () => {
  await prisma.$connect()
})
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => {
  await prisma.$disconnect()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

async function createSupportRecords() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const product = await prisma.product.create({
    data: { name: 'Peça simples', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 30, printTimeHours: 2, laborTimeHours: 0.25 },
  })
  return { printer, filament, product }
}

// Melhoria "Pedidos com múltiplos itens": createOrder agora recebe o
// cabeçalho solto + um itemsJson com 1 item só (mesmo contrato que o
// formulário usa pra N itens) -- este helper reproduz exatamente o caso
// de 1 item, preservando os testes de reconcileOrderReservations que só
// se importam com o item em si.
function orderFd(item: { productId: string; colorComboKey?: string; quantity: string; unitPrice?: string }, headerOverrides: Record<string, string> = {}): FormData {
  return fd({
    channel: 'DIRETA',
    orderDate: '2026-09-01',
    deliveryDate: '2026-09-20',
    ...headerOverrides,
    itemsJson: JSON.stringify([{
      productId: item.productId,
      colorComboKey: item.colorComboKey ?? null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice ?? '30'),
    }]),
  })
}

async function produce(productId: string, printerId: string, filamentId: string, quantitySuccess: string) {
  return createProductionRun(fd({
    productId,
    printerId,
    filamentId,
    date: '2026-09-01',
    quantityPlanned: quantitySuccess,
    quantitySuccess,
    quantityFailed: '0',
    gramsUsed: '30',
    gramsWasted: '0',
    timeWastedHours: '0',
  }))
}

describe('reconcileOrderReservations (via createOrder)', () => {
  it('pedido sem estoque nenhum nasce Aguardando produção, sem reserva', async () => {
    const { product } = await createSupportRecords()
    const result = await createOrder(orderFd({ productId: product.id, quantity: '2' }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('AGUARDANDO_PRODUCAO')
    expect(item.reservedQuantity).toBe(0)
  })

  it('pedido com estoque total disponível reserva tudo e vira Pronto — reservado', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '3')

    const result = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '3' }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('PRONTO_RESERVADO')
    expect(item.reservedQuantity).toBe(3)
  })

  it('bug "string vazia trava reserva pra sempre": colorComboKey="" (select sempre presente no form, mesmo sem cor escolhida) grava null e reserva normalmente', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '3')

    // OrderForm.tsx sempre manda o campo colorComboKey no item (mesmo ""
    // quando o comprador não escolheu cor nenhuma) -- criar o item com ""
    // explícito reproduz exatamente esse caso, em vez de omitir o campo
    // (que o zod trataria como undefined, nunca reproduziu o bug).
    const result = await createOrder(orderFd({ productId: product.id, colorComboKey: '', quantity: '3' }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.colorComboKey).toBeNull()
    expect(item.status).toBe('PRONTO_RESERVADO')
    expect(item.reservedQuantity).toBe(3)
  })

  // Bug "produção/montagem registrada mas pedido continua pendente pra
  // sempre, nem 'Recalcular pedidos' resolve": o teste acima só cobre
  // colorComboKey="" chegando via createOrder, que já normaliza pra null
  // ANTES de gravar (fix "corrigido na origem" citado no comentário de
  // orderReservations.ts) -- nunca reproduz uma linha GRAVADA como "" de
  // verdade no banco, sobrevivente de ANTES desse fix existir (fato
  // histórico, nunca reescrito). reconcileOrderReservations normalizava só
  // o valor em memória e buscava `colorComboKey: null` (SQL "IS NULL"), que
  // nunca bate com uma coluna que é literalmente "" -- esse item ficava
  // invisível pra reconciliação PRA SEMPRE, nem "Recalcular pedidos"
  // (reconcileAllPendingOrders, que só itera os pares (productId,
  // colorComboKey) já existentes e re-chama a mesma função) alcançava.
  it('bug "recalcular pedidos nunca resolve item legado com colorComboKey=\'\' gravado direto no banco"', async () => {
    const { product, printer, filament } = await createSupportRecords()

    // Bypassa createOrder de propósito -- grava "" direto via Prisma, como
    // uma linha realmente legada, pra não passar pela normalização que
    // createOrder já aplica hoje.
    const order = await prisma.order.create({
      data: {
        channel: 'DIRETA',
        orderDate: new Date('2026-09-01'),
        deliveryDate: new Date('2026-09-20'),
        items: { create: [{ productId: product.id, colorComboKey: '', quantity: 3, unitPrice: 30 }] },
      },
    })
    const itemBefore = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } })
    expect(itemBefore.colorComboKey).toBe('')
    expect(itemBefore.status).toBe('AGUARDANDO_PRODUCAO')

    await produce(product.id, printer.id, filament.id, '3')

    // "Recalcular pedidos" (botão manual em Produção) deve alcançar esse
    // item mesmo com "" gravado, não só colorComboKey null.
    await reconcileAllPendingOrders()

    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemBefore.id } })
    expect(item.status).toBe('PRONTO_RESERVADO')
    expect(item.reservedQuantity).toBe(3)
  })

  it('pedido com estoque parcial reserva o que existe e vira Parcial — aguardando produção', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    const result = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '3' }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('PARCIAL_AGUARDANDO_PRODUCAO')
    expect(item.reservedQuantity).toBe(1)
  })

  it('pedido novo com prazo mais urgente toma a peça de um pedido já reservado (realocação por prioridade)', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    // Pedido A: prazo mais longe (25/09), fica com a única peça disponível.
    const resultA = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1' }, { deliveryDate: '2026-09-25' }))
    expect(resultA.success).toBe(true)
    const itemA = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(itemA.status).toBe('PRONTO_RESERVADO')

    // Pedido B: prazo mais urgente (10/09) -- deve tomar a peça de A.
    const resultB = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1' }, { deliveryDate: '2026-09-10' }))
    expect(resultB.success).toBe(true)
    expect(resultB.reallocations).toHaveLength(1)
    expect(resultB.reallocations?.[0]).toMatchObject({ fromOrderItemId: itemA.id, quantity: 1 })

    const [refreshedA, itemB] = await Promise.all([
      prisma.orderItem.findUniqueOrThrow({ where: { id: itemA.id } }),
      prisma.orderItem.findFirstOrThrow({ where: { productId: product.id, id: { not: itemA.id } } }),
    ])
    expect(refreshedA.status).toBe('AGUARDANDO_PRODUCAO')
    expect(refreshedA.reservedQuantity).toBe(0)
    expect(itemB.status).toBe('PRONTO_RESERVADO')
    expect(itemB.reservedQuantity).toBe(1)

    const log = await prisma.orderReallocation.findMany({ where: { productId: product.id } })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ fromOrderItemId: itemA.id, toOrderItemId: itemB.id, quantity: 1 })
  })

  // Bug "Excluir antes de Cancelar dá um bug": um item que já perdeu peça
  // reservada por realocação (cenário acima) tem uma linha em
  // OrderReallocation apontando pra ele (fromOrderItemId) -- excluir o
  // PEDIDO desse item direto (Order.items usa onDelete: Cascade) tentava
  // apagar o OrderItem junto, o que violava a FK RESTRICT de
  // OrderReallocation e propagava um erro cru pra tela, em vez de devolver
  // uma mensagem explicando que cancelar (nunca apaga a linha, só muda o
  // status) resolve.
  it('excluir um pedido que já teve peça realocada devolve erro amigável, nunca lança exceção', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    const resultA = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1' }, { deliveryDate: '2026-09-25' }))
    expect(resultA.success).toBe(true)
    const itemA = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    const resultB = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1' }, { deliveryDate: '2026-09-10' }))
    expect(resultB.success).toBe(true)
    expect(resultB.reallocations).toHaveLength(1)

    const deleteResult = await deleteOrder(itemA.orderId)
    expect(deleteResult.success).toBe(false)
    expect(deleteResult.error).toMatch(/cancele/i)

    // Nunca apagado -- só a mensagem de erro, sem exceção não tratada.
    const stillExists = await prisma.orderItem.findUnique({ where: { id: itemA.id } })
    expect(stillExists).not.toBeNull()
  })

  it('cancelar um pedido reservado libera a peça pro próximo pedido pendente da fila', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    const resultA = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1' }, { deliveryDate: '2026-09-10' }))
    const itemA = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id }, include: { order: true } })
    expect(itemA.status).toBe('PRONTO_RESERVADO')
    void resultA

    // Pedido C: sem estoque no momento em que foi criado (A já tinha a
    // única peça), fica esperando.
    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1' }, { deliveryDate: '2026-09-15' }))
    const itemC = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id, id: { not: itemA.id } } })
    expect(itemC.status).toBe('AGUARDANDO_PRODUCAO')

    const cancelResult = await cancelOrder(itemA.orderId)
    expect(cancelResult.success).toBe(true)

    const [refreshedA, refreshedC] = await Promise.all([
      prisma.orderItem.findUniqueOrThrow({ where: { id: itemA.id } }),
      prisma.orderItem.findUniqueOrThrow({ where: { id: itemC.id } }),
    ])
    expect(refreshedA.status).toBe('CANCELADO')
    // Histórico preservado -- cancelar nunca reescreve reservedQuantity
    // retroativamente, só exclui o item da soma de "reservado" (mesma
    // filosofia de nunca reescrever fato passado que costSnapshot já usa).
    expect(refreshedA.reservedQuantity).toBe(1)
    expect(refreshedC.status).toBe('PRONTO_RESERVADO')
    expect(refreshedC.reservedQuantity).toBe(1)
  })

  it('excluir um pedido reservado também libera a peça pro próximo pendente', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1' }, { deliveryDate: '2026-09-10' }))
    const itemA = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1' }, { deliveryDate: '2026-09-15' }))
    const itemC = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id, id: { not: itemA.id } } })

    const deleteResult = await deleteOrder(itemA.orderId)
    expect(deleteResult.success).toBe(true)

    const refreshedC = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemC.id } })
    expect(refreshedC.status).toBe('PRONTO_RESERVADO')
    expect(refreshedC.reservedQuantity).toBe(1)
  })

  it('registrar produção nova preenche a reserva de um pedido pendente sozinho, sem passo manual de vincular ao pedido', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '3' }))
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('PARCIAL_AGUARDANDO_PRODUCAO')
    expect(item.reservedQuantity).toBe(1)

    // Mais produção da MESMA cor -- nenhuma referência ao pedido aqui,
    // simula o fluxo normal de "Registrar produção" na tela de Produção.
    const productionResult = await produce(product.id, printer.id, filament.id, '2')
    expect(productionResult.success).toBe(true)

    const refreshed = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(refreshed.status).toBe('PRONTO_RESERVADO')
    expect(refreshed.reservedQuantity).toBe(3)
  })
})

// Bug real relatado em produção (23-24/09): produto composto de várias
// peças -- registrar produção de uma peça (productPartId presente) nunca
// chamava reconcileOrderReservations (só confirmAssembly chamava), então
// um pedido ficava travado em AGUARDANDO_PRODUCAO mesmo depois de TODAS as
// peças necessárias já existirem soltas, esperando montagem -- só uma
// reconciliação por acaso (outro pedido criado/cancelado do mesmo
// produto) destravava. maybeReconcileAfterProduction (actions/
// productionRuns.ts) corrigido pra reconciliar também nesse caso.
async function createCompositeSupportRecords() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Rosa', colorHex: '#ff69b4', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const product = await prisma.product.create({
    data: { name: 'Amigurumi', category: 'Crochê', isComposite: true, printerId: printer.id, filamentId: filament.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0.5 },
  })
  const parts: Record<string, { id: string }> = {}
  for (const name of ['CORPO', 'PÉS', 'OLHOS']) {
    parts[name] = await prisma.productPart.create({
      data: { productId: product.id, name, printerId: printer.id, printTimeHours: 0.3, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: filament.id, weightGrams: 5 }] } },
    })
  }
  return { printer, filament, product, parts }
}

async function producePart(productId: string, partId: string, printerId: string, filamentId: string, quantitySuccess: string) {
  return createProductionRun(fd({
    productId,
    productPartId: partId,
    printerId,
    filamentId,
    date: '2026-09-01',
    quantityPlanned: quantitySuccess,
    quantitySuccess,
    quantityFailed: '0',
    gramsUsed: '5',
    gramsWasted: '0',
    timeWastedHours: '0',
  }))
}

describe('reconcileOrderReservations dispara sozinho ao produzir PEÇA de produto composto', () => {
  it('pedido migra pra Aguardando montagem assim que a última peça necessária é produzida, sem nenhum outro evento de pedido', async () => {
    const { printer, filament, product, parts } = await createCompositeSupportRecords()

    // 2 das 3 peças já produzidas ANTES do pedido existir.
    await producePart(product.id, parts['PÉS'].id, printer.id, filament.id, '1')
    await producePart(product.id, parts['OLHOS'].id, printer.id, filament.id, '1')

    const orderResult = await createOrder(orderFd({ productId: product.id, quantity: '1' }))
    expect(orderResult.success).toBe(true)
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('AGUARDANDO_PRODUCAO')

    // Produz a última peça que faltava -- nenhuma referência ao pedido
    // aqui, mesmo padrão de "Registrar produção" na tela de Produção.
    const productionResult = await producePart(product.id, parts['CORPO'].id, printer.id, filament.id, '1')
    expect(productionResult.success).toBe(true)

    const refreshed = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(refreshed.status).toBe('AGUARDANDO_MONTAGEM')
    expect(refreshed.reservedQuantity).toBe(0)
  })
})

// Pedido do usuário "editar um pedido pra adicionar uma peça": addOrderItems
// acrescenta OrderItem a um Order já criado, sem tocar no cabeçalho --
// mesma validação/reconciliação de createOrder, só que targeting um
// orderId existente em vez de criar um Order novo.
describe('addOrderItems', () => {
  it('acrescenta um item a um pedido já existente, preservando o item original e reconciliando o novo', async () => {
    const { product, printer, filament } = await createSupportRecords()
    const base = await prisma.product.create({
      data: { name: 'Peça base', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0.1 },
    })

    const orderResult = await createOrder(orderFd({ productId: product.id, quantity: '2' }))
    expect(orderResult.success).toBe(true)
    const originalItem = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    const order = await prisma.order.findUniqueOrThrow({ where: { id: originalItem.orderId } })

    await produce(base.id, printer.id, filament.id, '5')

    const addResult = await addOrderItems(order.id, fd({
      itemsJson: JSON.stringify([{ productId: base.id, colorComboKey: filament.id, quantity: 5, unitPrice: 15 }]),
    }))
    expect(addResult.success).toBe(true)

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } })
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe(originalItem.id)
    expect(items[0].productId).toBe(product.id)
    expect(items[1].productId).toBe(base.id)
    expect(items[1].quantity).toBe(5)
    // Peça base tinha estoque pronto -- o novo item já nasce reservado,
    // mesma reconciliação que createOrder dispara pra item novo.
    expect(items[1].status).toBe('PRONTO_RESERVADO')
    expect(items[1].reservedQuantity).toBe(5)
  })

  it('rejeita quando o pedido não existe', async () => {
    const result = await addOrderItems('pedido-inexistente', fd({
      itemsJson: JSON.stringify([{ productId: 'x', colorComboKey: null, quantity: 1, unitPrice: 10 }]),
    }))
    expect(result.success).toBe(false)
  })
})

// Pedido do usuário "editar item depois de adicionado": updateOrderItem
// corrige quantidade/valor de um item já salvo; removeOrderItem tira o
// item do pedido de vez. Os dois reconciliam a fila (productId,
// colorComboKey) em seguida -- mesmo motor que createOrder/cancelOrder já
// usam, só que disparado por uma edição/remoção em vez de criação.
describe('updateOrderItem', () => {
  it('diminuir a quantidade encolhe reservedQuantity (nunca fica maior que quantity) e libera a sobra pro pool', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '5')

    const orderResult = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '5' }))
    expect(orderResult.success).toBe(true)
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.reservedQuantity).toBe(5)

    const result = await updateOrderItem(item.id, fd({ quantity: '2', unitPrice: '30' }))
    expect(result.success).toBe(true)

    const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(updated.quantity).toBe(2)
    expect(updated.reservedQuantity).toBe(2)
    expect(updated.status).toBe('PRONTO_RESERVADO')
  })

  it('rejeita editar um item que já virou venda (saleId setado)', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '3')
    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '3' }))
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    const delivered = await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))
    expect(delivered.success).toBe(true)

    const result = await updateOrderItem(item.id, fd({ quantity: '1', unitPrice: '30' }))
    expect(result.success).toBe(false)
  })
})

describe('removeOrderItem', () => {
  it('remove o item e libera a peça reservada pro próximo pedido da fila (prazo mais próximo)', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '3')

    // Pedido A (entrega mais perto) fica com a peça; pedido B (mais longe)
    // nasce Aguardando produção -- mesmo cenário de prioridade que
    // reconcileOrderReservations já cobre em createOrder.
    const orderA = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '3' }, { deliveryDate: '2026-09-05' }))
    expect(orderA.success).toBe(true)
    const itemA = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id }, orderBy: { createdAt: 'asc' } })
    expect(itemA.reservedQuantity).toBe(3)

    const orderB = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '2' }, { deliveryDate: '2026-09-25' }))
    expect(orderB.success).toBe(true)
    const itemB = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id, id: { not: itemA.id } } })
    expect(itemB.reservedQuantity).toBe(0)

    // Pedido A tem só 1 item -- adiciona um 2º item qualquer pra passar da
    // guarda "não remove o último item do pedido" e isolar o teste nela.
    const base = await prisma.product.create({
      data: { name: 'Peça base', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 5, printTimeHours: 0.5, laborTimeHours: 0 },
    })
    await prisma.orderItem.create({ data: { orderId: itemA.orderId, productId: base.id, quantity: 1, unitPrice: 10 } })

    const result = await removeOrderItem(itemA.id)
    expect(result.success).toBe(true)

    const stillThere = await prisma.orderItem.findUnique({ where: { id: itemA.id } })
    expect(stillThere).toBeNull()

    const refreshedB = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemB.id } })
    expect(refreshedB.reservedQuantity).toBe(2)
    expect(refreshedB.status).toBe('PRONTO_RESERVADO')
  })

  it('rejeita remover um item que já virou venda (saleId setado)', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '2')
    const base = await prisma.product.create({
      data: { name: 'Peça base', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 5, printTimeHours: 0.5, laborTimeHours: 0 },
    })
    const orderResult = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '2' }))
    expect(orderResult.success).toBe(true)
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    await prisma.orderItem.create({ data: { orderId: item.orderId, productId: base.id, quantity: 1, unitPrice: 10 } })

    const delivered = await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))
    expect(delivered.success).toBe(true)

    const result = await removeOrderItem(item.id)
    expect(result.success).toBe(false)
  })

  it('rejeita remover o único item do pedido (sugere excluir o pedido inteiro)', async () => {
    const { product } = await createSupportRecords()
    await createOrder(orderFd({ productId: product.id, quantity: '1' }))
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    const result = await removeOrderItem(item.id)
    expect(result.success).toBe(false)
  })
})
