import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, cancelOrder, deleteOrder } from '@/actions/orders'
import { createProductionRun } from '@/actions/productionRuns'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderReallocation.deleteMany()
  await prisma.order.deleteMany()
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

function orderFd(overrides: Record<string, string> = {}): FormData {
  return fd({
    channel: 'DIRETA',
    quantity: '1',
    unitPrice: '30',
    orderDate: '2026-09-01',
    deliveryDate: '2026-09-20',
    ...overrides,
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

    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(order.status).toBe('AGUARDANDO_PRODUCAO')
    expect(order.reservedQuantity).toBe(0)
  })

  it('pedido com estoque total disponível reserva tudo e vira Pronto — reservado', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '3')

    const result = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '3' }))
    expect(result.success).toBe(true)

    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(order.status).toBe('PRONTO_RESERVADO')
    expect(order.reservedQuantity).toBe(3)
  })

  it('pedido com estoque parcial reserva o que existe e vira Parcial — aguardando produção', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    const result = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '3' }))
    expect(result.success).toBe(true)

    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(order.status).toBe('PARCIAL_AGUARDANDO_PRODUCAO')
    expect(order.reservedQuantity).toBe(1)
  })

  it('pedido novo com prazo mais urgente toma a peça de um pedido já reservado (realocação por prioridade)', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    // Pedido A: prazo mais longe (25/09), fica com a única peça disponível.
    const resultA = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1', deliveryDate: '2026-09-25' }))
    expect(resultA.success).toBe(true)
    const orderA = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(orderA.status).toBe('PRONTO_RESERVADO')

    // Pedido B: prazo mais urgente (10/09) -- deve tomar a peça de A.
    const resultB = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1', deliveryDate: '2026-09-10' }))
    expect(resultB.success).toBe(true)
    expect(resultB.reallocations).toHaveLength(1)
    expect(resultB.reallocations?.[0]).toMatchObject({ fromOrderId: orderA.id, quantity: 1 })

    const [refreshedA, orderB] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: orderA.id } }),
      prisma.order.findFirstOrThrow({ where: { productId: product.id, id: { not: orderA.id } } }),
    ])
    expect(refreshedA.status).toBe('AGUARDANDO_PRODUCAO')
    expect(refreshedA.reservedQuantity).toBe(0)
    expect(orderB.status).toBe('PRONTO_RESERVADO')
    expect(orderB.reservedQuantity).toBe(1)

    const log = await prisma.orderReallocation.findMany({ where: { productId: product.id } })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ fromOrderId: orderA.id, toOrderId: orderB.id, quantity: 1 })
  })

  it('cancelar um pedido reservado libera a peça pro próximo pedido pendente da fila', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    const resultA = await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1', deliveryDate: '2026-09-10' }))
    const orderA = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(orderA.status).toBe('PRONTO_RESERVADO')
    void resultA

    // Pedido C: sem estoque no momento em que foi criado (A já tinha a
    // única peça), fica esperando.
    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1', deliveryDate: '2026-09-15' }))
    const orderC = await prisma.order.findFirstOrThrow({ where: { productId: product.id, id: { not: orderA.id } } })
    expect(orderC.status).toBe('AGUARDANDO_PRODUCAO')

    const cancelResult = await cancelOrder(orderA.id)
    expect(cancelResult.success).toBe(true)

    const [refreshedA, refreshedC] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: orderA.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: orderC.id } }),
    ])
    expect(refreshedA.status).toBe('CANCELADO')
    // Histórico preservado -- cancelar nunca reescreve reservedQuantity
    // retroativamente, só exclui o pedido da soma de "reservado" (mesma
    // filosofia de nunca reescrever fato passado que costSnapshot já usa).
    expect(refreshedA.reservedQuantity).toBe(1)
    expect(refreshedC.status).toBe('PRONTO_RESERVADO')
    expect(refreshedC.reservedQuantity).toBe(1)
  })

  it('excluir um pedido reservado também libera a peça pro próximo pendente', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1', deliveryDate: '2026-09-10' }))
    const orderA = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })

    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '1', deliveryDate: '2026-09-15' }))
    const orderC = await prisma.order.findFirstOrThrow({ where: { productId: product.id, id: { not: orderA.id } } })

    const deleteResult = await deleteOrder(orderA.id)
    expect(deleteResult.success).toBe(true)

    const refreshedC = await prisma.order.findUniqueOrThrow({ where: { id: orderC.id } })
    expect(refreshedC.status).toBe('PRONTO_RESERVADO')
    expect(refreshedC.reservedQuantity).toBe(1)
  })

  it('registrar produção nova preenche a reserva de um pedido pendente sozinho, sem passo manual de vincular ao pedido', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '1')

    await createOrder(orderFd({ productId: product.id, colorComboKey: filament.id, quantity: '3' }))
    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(order.status).toBe('PARCIAL_AGUARDANDO_PRODUCAO')
    expect(order.reservedQuantity).toBe(1)

    // Mais produção da MESMA cor -- nenhuma referência ao pedido aqui,
    // simula o fluxo normal de "Registrar produção" na tela de Produção.
    const productionResult = await produce(product.id, printer.id, filament.id, '2')
    expect(productionResult.success).toBe(true)

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
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
    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(order.status).toBe('AGUARDANDO_PRODUCAO')

    // Produz a última peça que faltava -- nenhuma referência ao pedido
    // aqui, mesmo padrão de "Registrar produção" na tela de Produção.
    const productionResult = await producePart(product.id, parts['CORPO'].id, printer.id, filament.id, '1')
    expect(productionResult.success).toBe(true)

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(refreshed.status).toBe('AGUARDANDO_MONTAGEM')
    expect(refreshed.reservedQuantity).toBe(0)
  })
})
