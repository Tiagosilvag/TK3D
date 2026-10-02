import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createNotification, resolveNotificationsForResource, markNotificationsSeen, getUnresolvedCount, getUnseenNotifications } from '@/lib/notifications'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.notification.deleteMany()
})

describe('notifications', () => {
  it('createNotification cria e conta como não resolvida', async () => {
    await createNotification({ type: 'NOVO_PEDIDO_MARKETPLACE', title: 'Pedido novo', resourceType: 'MarketplaceOrderInbox', resourceId: 'inbox-1' })
    expect(await getUnresolvedCount()).toBe(1)
  })

  it('resolveNotificationsForResource resolve só as do recurso certo', async () => {
    await createNotification({ type: 'NOVO_PEDIDO_MARKETPLACE', title: 'A', resourceType: 'MarketplaceOrderInbox', resourceId: 'inbox-1' })
    await createNotification({ type: 'NOVO_PEDIDO_MARKETPLACE', title: 'B', resourceType: 'MarketplaceOrderInbox', resourceId: 'inbox-2' })
    await resolveNotificationsForResource('MarketplaceOrderInbox', 'inbox-1')
    expect(await getUnresolvedCount()).toBe(1)
    // Verify the remaining unresolved notification is the correct one (inbox-2, not inbox-1)
    const unresolved = await prisma.notification.findMany({ where: { resolvedAt: null } })
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0].resourceId).toBe('inbox-2')
  })

  it('markNotificationsSeen marca vistas e getUnseenNotifications para de devolvê-las', async () => {
    await createNotification({ type: 'NOVO_PEDIDO_MARKETPLACE', title: 'A' })
    const [n] = await getUnseenNotifications()
    await markNotificationsSeen([n.id])
    expect(await getUnseenNotifications()).toHaveLength(0)
  })
})
