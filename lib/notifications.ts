import { prisma } from '@/lib/prisma'
import type { Notification, NotificationType } from '@prisma/client'

const TERMINAL_STATUSES = new Set(['ENTREGUE', 'CANCELADO'])

export function areAllItemsTerminal(statuses: string[]): boolean {
  return statuses.every((status) => TERMINAL_STATUSES.has(status))
}

export interface CreateNotificationInput {
  type: NotificationType
  title: string
  body?: string
  link?: string
  resourceType?: string
  resourceId?: string
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await prisma.notification.create({ data: input })
}

export async function resolveNotificationsForResource(resourceType: string, resourceId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { resourceType, resourceId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  })
}

export async function markNotificationsSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { seenAt: new Date() } })
}

export async function getUnresolvedCount(): Promise<number> {
  return prisma.notification.count({ where: { resolvedAt: null } })
}

export async function getUnseenNotifications(): Promise<Notification[]> {
  return prisma.notification.findMany({ where: { seenAt: null }, orderBy: { createdAt: 'asc' } })
}
