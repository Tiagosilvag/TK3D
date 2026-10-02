import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, updateOrderItemStatus } from '@/actions/orders'
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
