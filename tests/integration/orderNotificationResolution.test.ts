import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, updateOrderItemStatus, cancelOrder, deleteOrder } from '@/actions/orders'
import { createProductionRun } from '@/actions/productionRuns'
import { createNotification, getUnresolvedCount } from '@/lib/notifications'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.notification.deleteMany()
  await prisma.marketplaceOrderInbox.deleteMany()
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.stockConsumption.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { laborCostPerHour: 10, defaultMarkup: 2, energyCostPerKwh: 1, failureRatePercent: 0.1, taxPercent: 0.055 },
    create: { id: 1 },
  })
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

async function createSimpleProduct(name: string) {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  return prisma.product.create({
    data: { name, category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 0.1, laborTimeHours: 0.05 },
  })
}

// Pedido com N itens, cada um de um produto diferente (evita disputar
// reserva de estoque entre itens do mesmo produto, irrelevante pra este
// teste -- só interessa o status de cada OrderItem).
async function createOrderWithItems(productIds: string[]): Promise<string> {
  const result = await createOrder(
    fd({
      channel: 'DIRETA',
      orderDate: '2026-09-01',
      deliveryDate: '2026-09-20',
      itemsJson: JSON.stringify(productIds.map((productId) => ({ productId, colorComboKey: null, quantity: 1, unitPrice: 30 }))),
    }),
  )
  expect(result.success).toBe(true)
  const order = await prisma.order.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })
  return order.id
}

async function linkInboxWithNotification(orderId: string): Promise<string> {
  const inbox = await prisma.marketplaceOrderInbox.create({
    data: {
      platform: 'MERCADO_LIVRE',
      externalOrderId: `ext-${orderId}`,
      totalAmount: 30,
      items: [],
      status: 'CONFIRMADO',
      confirmedOrderId: orderId,
    },
  })
  await createNotification({
    type: 'NOVO_PEDIDO_MARKETPLACE',
    title: 'Pedido novo',
    resourceType: 'MarketplaceOrderInbox',
    resourceId: inbox.id,
  })
  return inbox.id
}

describe('updateOrderItemStatus -- resolução automática de notificação', () => {
  it('CANCELADO (caminho early-return): resolve só quando TODOS os itens do pedido ficam terminais', async () => {
    const [p1, p2] = await Promise.all([createSimpleProduct('A'), createSimpleProduct('B')])
    const orderId = await createOrderWithItems([p1.id, p2.id])
    await linkInboxWithNotification(orderId)
    const items = await prisma.orderItem.findMany({ where: { orderId } })
    expect(items).toHaveLength(2)

    expect(await getUnresolvedCount()).toBe(1)

    // Cancela só o primeiro item -- o segundo continua AGUARDANDO_PRODUCAO
    // (não terminal), então a notificação não deve ser resolvida ainda.
    const r1 = await updateOrderItemStatus(items[0].id, fd({ status: 'CANCELADO' }))
    expect(r1.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(1)

    // Cancela o segundo item -- agora todos são terminais, resolve.
    const r2 = await updateOrderItemStatus(items[1].id, fd({ status: 'CANCELADO' }))
    expect(r2.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(0)
  })

  it('ENTREGUE (caminho que cria Sale): resolve só quando TODOS os itens do pedido ficam terminais', async () => {
    const [p1, p2] = await Promise.all([createSimpleProduct('C'), createSimpleProduct('D')])
    const orderId = await createOrderWithItems([p1.id, p2.id])
    await linkInboxWithNotification(orderId)
    const items = await prisma.orderItem.findMany({ where: { orderId } })

    expect(await getUnresolvedCount()).toBe(1)

    // Entrega só o primeiro item -- o segundo continua pendente, não
    // resolve ainda.
    const r1 = await updateOrderItemStatus(items[0].id, fd({ status: 'ENTREGUE' }))
    expect(r1.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(1)

    // Entrega o segundo item também (via CANCELADO, outro status terminal,
    // pra cobrir o caso de um pedido fechar com uma mistura de
    // entregue+cancelado) -- agora todos terminais, resolve.
    const r2 = await updateOrderItemStatus(items[1].id, fd({ status: 'CANCELADO' }))
    expect(r2.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(0)
  })

  it('pedido sem MarketplaceOrderInbox vinculado (criado manualmente) não falha e não mexe em notificação nenhuma', async () => {
    const product = await createSimpleProduct('E')
    const orderId = await createOrderWithItems([product.id])
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } })

    const result = await updateOrderItemStatus(item.id, fd({ status: 'CANCELADO' }))
    expect(result.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(0)
  })
})

// Finding 2 (revisão final da integração Mercado Livre): cancelOrder
// cancela via updateMany direto (nunca passou por updateOrderItemStatus),
// então nunca chamava resolveMarketplaceNotificationIfTerminal -- a
// notificação do sino ficava presa mesmo com TODOS os itens do pedido
// cancelados de uma vez.
describe('cancelOrder -- resolução automática de notificação', () => {
  it('resolve a notificação quando cancela TODOS os itens pendentes do pedido de uma vez', async () => {
    const [p1, p2] = await Promise.all([createSimpleProduct('F'), createSimpleProduct('G')])
    const orderId = await createOrderWithItems([p1.id, p2.id])
    await linkInboxWithNotification(orderId)
    expect(await getUnresolvedCount()).toBe(1)

    const result = await cancelOrder(orderId)
    expect(result.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(0)
  })

  it('não resolve quando algum item do pedido já estava ENTREGUE (fora do alvo de cancelOrder) e os demais são cancelados -- resolve só quando TODOS ficam terminais', async () => {
    const [p1, p2] = await Promise.all([createSimpleProduct('H'), createSimpleProduct('I')])
    const orderId = await createOrderWithItems([p1.id, p2.id])
    await linkInboxWithNotification(orderId)
    const items = await prisma.orderItem.findMany({ where: { orderId } })

    // Entrega o primeiro item primeiro (vira terminal por outro caminho) --
    // a notificação ainda não deveria resolver (o segundo item continua
    // pendente).
    await updateOrderItemStatus(items[0].id, fd({ status: 'ENTREGUE' }))
    expect(await getUnresolvedCount()).toBe(1)

    // cancelOrder só tem UM item não-terminal pra cancelar agora (o já
    // entregue fica de fora, `targets` o exclui) -- mas como ele é o
    // ÚLTIMO item não-terminal do pedido, cancelar fecha o pedido inteiro
    // (todos terminais: 1 entregue + 1 cancelado) e resolve.
    const result = await cancelOrder(orderId)
    expect(result.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(0)
  })

  it('pedido sem MarketplaceOrderInbox vinculado não falha ao cancelar', async () => {
    const product = await createSimpleProduct('J')
    const orderId = await createOrderWithItems([product.id])

    const result = await cancelOrder(orderId)
    expect(result.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(0)
  })
})

// Finding 2: deleteOrder apaga o Order, o que faz ON DELETE SET NULL em
// MarketplaceOrderInbox.confirmedOrderId (prisma/schema.prisma) -- depois
// disso a linha do inbox fica impossível de achar por confirmedOrderId
// pra sempre, e sua notificação nunca mais resolveria. deleteOrder agora
// resolve ANTES de perder esse vínculo.
describe('deleteOrder -- resolução automática de notificação', () => {
  it('resolve a notificação do inbox vinculado ao excluir o pedido (sem item entregue, delete direto sem RESTRICT)', async () => {
    const product = await createSimpleProduct('K')
    const orderId = await createOrderWithItems([product.id])
    await linkInboxWithNotification(orderId)
    expect(await getUnresolvedCount()).toBe(1)

    const result = await deleteOrder(orderId)
    expect(result.success).toBe(true)
    expect(await getUnresolvedCount()).toBe(0)
  })

  it('NÃO resolve a notificação quando o delete falha (RESTRICT de OrderReallocation) -- o pedido continua existindo', async () => {
    // Mesmo cenário de tests/integration/orderReservations.test.ts ("excluir
    // um pedido que já teve peça realocada"): produz 1 unidade, pedido A
    // (prazo mais longe) fica com ela reservada, pedido B (prazo mais
    // urgente) toma a peça de A -- grava uma OrderReallocation permanente
    // (RESTRICT) que impede excluir A direto (cascade tentaria apagar o
    // OrderItem referenciado por fromOrderItemId).
    const product = await createSimpleProduct('L')
    const orderAId = await createOrderWithItems([product.id])
    await linkInboxWithNotification(orderAId)
    expect(await getUnresolvedCount()).toBe(1)

    const printer = await prisma.printer.findFirstOrThrow({ where: { name: 'P1' } })
    const filament = await prisma.filament.findFirstOrThrow({ where: { colorName: 'Preto' } })
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
    // Pedido B com prazo mais urgente que o de A (criado em
    // createOrderWithItems com deliveryDate '2026-09-20') -- toma a peça.
    const resultB = await createOrder(fd({
      channel: 'DIRETA',
      orderDate: '2026-09-01',
      deliveryDate: '2026-09-02',
      itemsJson: JSON.stringify([{ productId: product.id, colorComboKey: null, quantity: 1, unitPrice: 30 }]),
    }))
    expect(resultB.success).toBe(true)
    expect(resultB.reallocations).toHaveLength(1)

    const result = await deleteOrder(orderAId)
    expect(result.success).toBe(false)
    expect(await getUnresolvedCount()).toBe(1)
    expect(await prisma.order.findUnique({ where: { id: orderAId } })).not.toBeNull()
  })
})
