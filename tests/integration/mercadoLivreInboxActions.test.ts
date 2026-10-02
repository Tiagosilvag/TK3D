import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { confirmInboxOrder, ignoreInboxOrder } from '@/actions/mercadoLivreOrders'
import { createProductionRun } from '@/actions/productionRuns'
import { createOrder } from '@/actions/orders'
import { createNotification, getUnresolvedCount } from '@/lib/notifications'

// Não roda neste sandbox (sem banco de teste vivo) -- documenta o
// comportamento esperado de actions/mercadoLivreOrders.ts, mesma
// convenção de tests/integration/orderReservations.test.ts (TEST_DATABASE_URL).
const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.notification.deleteMany()
  await prisma.marketplaceOrderInbox.deleteMany()
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
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
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const product = await prisma.product.create({
    data: { name: 'Chaveiro', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 },
  })
  return { printer, filament, product }
}

describe('confirmInboxOrder', () => {
  it('cria Order+OrderItem e marca o inbox como CONFIRMADO', async () => {
    const { product } = await createSupportRecords()
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '1',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB1', title: 'Chaveiro', sku: null, quantity: 1, unitPrice: 50 }],
      },
    })

    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB1', productId: product.id, colorComboKey: null }], new Date('2026-09-20'))

    expect(result.success).toBe(true)
    const updatedInbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updatedInbox.status).toBe('CONFIRMADO')
    expect(updatedInbox.confirmedOrderId).not.toBeNull()
  })

  it('rejeita confirmar um inbox que já não está PENDENTE', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '2', totalAmount: 50, items: [], status: 'IGNORADO' },
    })
    const result = await confirmInboxOrder(inbox.id, [], new Date('2026-09-20'))
    expect(result.success).toBe(false)
  })

  it('rejeita quando faltou mapear o produto de algum item', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '4',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB4', title: 'Chaveiro', sku: null, quantity: 1, unitPrice: 50 }],
      },
    })
    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB4', productId: '', colorComboKey: null }], new Date('2026-09-20'))
    expect(result.success).toBe(false)
    const updatedInbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updatedInbox.status).toBe('PENDENTE')
  })

  // Finding 4 (revisão final): deliveryDate/orderDate deixaram de ser
  // `new Date()` fixo -- deliveryDate agora é escolhido por quem confirma
  // (antes disso, TODO pedido do ML nascia "pra entregar hoje", furando a
  // fila de reconcileOrderReservations, que aloca por prazo mais próximo
  // primeiro -- na prática roubando peça reservada de pedidos manuais com
  // prazo real). orderDate vem de `inbox.receivedAt` (quando o pedido
  // chegou de verdade), não de quando o humano confirmou.
  it('usa o deliveryDate escolhido pelo usuário (não "agora") e orderDate = inbox.receivedAt (não "agora")', async () => {
    const { product } = await createSupportRecords()
    const receivedAt = new Date('2026-08-15T10:00:00Z')
    const chosenDeliveryDate = new Date('2026-09-25T00:00:00Z')
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '10',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB10', title: 'Chaveiro', sku: null, quantity: 1, unitPrice: 50 }],
        receivedAt,
      },
    })

    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB10', productId: product.id, colorComboKey: null }], chosenDeliveryDate)
    expect(result.success).toBe(true)

    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId! } })
    expect(order.deliveryDate.toISOString()).toBe(chosenDeliveryDate.toISOString())
    expect(order.orderDate.toISOString()).toBe(receivedAt.toISOString())
  })

  // Finding 4: confirmInboxOrder descartava `reallocations` -- se
  // confirmar um pedido do ML tomasse peça reservada de outro pedido, o
  // usuário não era avisado (diferente de OrderForm.tsx, que mostra um
  // banner). Monta um pedido manual com prazo mais distante já reservado,
  // depois confirma um pedido do ML (prazo mais próximo) pela mesma
  // cor/produto -- reconcileOrderReservations deve tomar a peça do pedido
  // manual, e o evento precisa voltar em `reallocations`.
  it('retorna reallocations quando confirmar o pedido do ML desloca a reserva de outro pedido', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '1',
      quantitySuccess: '1',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))

    // Pedido manual com prazo distante -- reivindica a única unidade
    // disponível (reservedQuantity = 1, PRONTO_RESERVADO).
    const manualOrderResult = await createOrder(fd({
      channel: 'DIRETA',
      orderDate: '2026-09-01',
      deliveryDate: '2026-12-31',
      itemsJson: JSON.stringify([{ productId: product.id, colorComboKey: null, quantity: 1, unitPrice: 50 }]),
    }))
    expect(manualOrderResult.success).toBe(true)
    const manualItemBefore = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(manualItemBefore.reservedQuantity).toBe(1)

    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '11',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB11', title: 'Chaveiro', sku: null, quantity: 1, unitPrice: 50 }],
      },
    })

    // Prazo do ML mais próximo que o do pedido manual -- deve furar a
    // fila e tomar a única unidade disponível.
    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB11', productId: product.id, colorComboKey: null }], new Date('2026-09-05'))
    expect(result.success).toBe(true)
    expect(result.reallocations).toBeDefined()
    expect(result.reallocations!.length).toBeGreaterThan(0)
    expect(result.reallocations![0].fromOrderItemId).toBe(manualItemBefore.id)

    const manualItemAfter = await prisma.orderItem.findUniqueOrThrow({ where: { id: manualItemBefore.id } })
    expect(manualItemAfter.reservedQuantity).toBe(0)
  })

  // Finding 5 (revisão final): duplo-clique/duas abas confirmando o MESMO
  // inbox quase ao mesmo tempo -- sem a reivindicação atômica, os dois
  // passariam pela checagem de status antes de qualquer um gravar, cada
  // um criando seu próprio Order (double-booking de estoque). Simula as
  // duas chamadas concorrentes (Promise.all, sem await entre elas) e prova
  // que só UMA cria Order -- a outra recebe success:false.
  it('duas chamadas concorrentes de confirmInboxOrder no mesmo inbox só criam UM Order', async () => {
    const { product } = await createSupportRecords()
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '12',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB12', title: 'Chaveiro', sku: null, quantity: 1, unitPrice: 50 }],
      },
    })

    const mappings = [{ externalItemId: 'MLB12', productId: product.id, colorComboKey: null }]
    const [resultA, resultB] = await Promise.all([
      confirmInboxOrder(inbox.id, mappings, new Date('2026-09-20')),
      confirmInboxOrder(inbox.id, mappings, new Date('2026-09-20')),
    ])

    const successes = [resultA, resultB].filter((r) => r.success)
    const failures = [resultA, resultB].filter((r) => !r.success)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toBe('Este pedido já foi processado')
    expect(await prisma.order.count()).toBe(1)

    const updatedInbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updatedInbox.status).toBe('CONFIRMADO')
  })

  // Defeito real do brief corrigido na implementação: sem a chamada a
  // reconcileOrderReservations, um OrderItem criado por esta action nunca
  // teria reservedQuantity atualizado, mesmo com peça pronta em estoque
  // (CLAUDE.md "estoque derivado, não contador redundante" -- o campo
  // NUNCA é escrito à mão, só recalculado). Este teste prova o efeito
  // observável: produzir a peça ANTES de confirmar o pedido do ML, e
  // conferir que o item nasce com a peça já reservada (PRONTO_RESERVADO),
  // não com reservedQuantity preso em 0.
  it('reconcilia a reserva do item criado -- reservedQuantity reflete o estoque disponível no momento da confirmação', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '5',
      quantitySuccess: '5',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))

    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '5',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB5', title: 'Chaveiro', sku: null, quantity: 2, unitPrice: 25 }],
      },
    })

    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB5', productId: product.id, colorComboKey: null }], new Date('2026-09-20'))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.reservedQuantity).toBe(2)
    expect(item.status).toBe('PRONTO_RESERVADO')
  })
})

describe('ignoreInboxOrder', () => {
  it('marca como IGNORADO sem criar Order', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '3', totalAmount: 50, items: [] },
    })
    const result = await ignoreInboxOrder(inbox.id)
    expect(result.success).toBe(true)
    const updated = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updated.status).toBe('IGNORADO')
    expect(await prisma.order.count()).toBe(0)
  })

  // Finding 2 (revisão final): uma linha ignorada nunca vira Order -- não
  // tem orderId pra passar pelo caminho de resolveMarketplaceNotificationIfTerminal
  // (actions/orders.ts). Antes deste fix, ignorar um pedido do ML nunca
  // resolvia a notificação de "pedido novo" vinculada a ele -- o sino
  // ficava preso pra sempre mesmo num pedido explicitamente descartado.
  it('resolve a notificação NOVO_PEDIDO_MARKETPLACE vinculada ao inbox ignorado', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '13', totalAmount: 50, items: [] },
    })
    await createNotification({
      type: 'NOVO_PEDIDO_MARKETPLACE',
      title: 'Pedido novo',
      resourceType: 'MarketplaceOrderInbox',
      resourceId: inbox.id,
    })
    expect(await getUnresolvedCount()).toBe(1)

    const result = await ignoreInboxOrder(inbox.id)
    expect(result.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(0)
  })

  // Finding 5: mesma trava atômica de confirmInboxOrder -- duas chamadas
  // concorrentes (duplo-clique) no mesmo inbox PENDENTE só devem deixar
  // UMA mudar o status; a outra recebe o erro "já foi processado" em vez
  // de reprocessar (e, no caso de confirmar, criar um segundo Order).
  it('duas chamadas concorrentes de ignoreInboxOrder no mesmo inbox: só uma reporta sucesso', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '14', totalAmount: 50, items: [] },
    })

    const [resultA, resultB] = await Promise.all([ignoreInboxOrder(inbox.id), ignoreInboxOrder(inbox.id)])

    const successes = [resultA, resultB].filter((r) => r.success)
    const failures = [resultA, resultB].filter((r) => !r.success)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toBe('Este pedido já foi processado')
  })
})
