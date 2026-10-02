import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { saveConnection } from '@/lib/mercadoLivre/connection'
import { processOrderNotification } from '@/lib/mercadoLivre/orders'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.notification.deleteMany()
  await prisma.marketplaceOrderInbox.deleteMany()
  await prisma.marketplaceConnection.deleteMany()
  await saveConnection({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresIn: 21600, userId: '999' })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('processOrderNotification', () => {
  it('cria o inbox e a notificação na primeira vez', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 555,
        buyer: { nickname: 'joao123' },
        total_amount: 100,
        order_items: [{ item: { id: 'MLB1', title: 'Produto X', seller_sku: null }, quantity: 1, unit_price: 100 }],
      }),
    }) as unknown as typeof fetch

    await processOrderNotification('555')

    const inbox = await prisma.marketplaceOrderInbox.findUnique({ where: { platform_externalOrderId: { platform: 'MERCADO_LIVRE', externalOrderId: '555' } } })
    expect(inbox?.status).toBe('PENDENTE')
    const notifications = await prisma.notification.findMany()
    expect(notifications).toHaveLength(1)
  })

  it('reprocessar o mesmo pedido (webhook duplicado) não cria segunda notificação', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 555, total_amount: 100, order_items: [] }),
    }) as unknown as typeof fetch

    await processOrderNotification('555')
    await processOrderNotification('555')

    const notifications = await prisma.notification.findMany()
    expect(notifications).toHaveLength(1)
    const inboxRows = await prisma.marketplaceOrderInbox.findMany()
    expect(inboxRows).toHaveLength(1)
  })
})
