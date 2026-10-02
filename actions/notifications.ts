'use server'
import { markNotificationsSeen as markSeen } from '@/lib/notifications'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

// Sino de notificações (genérico): marca como vistas as notificações
// listadas na modal "Novidades" (NotificationBell) ao fechar -- nunca
// reabre sozinha pra essa mesma leva depois disso, já que
// getUnseenNotifications (lib/notifications.ts) só lista seenAt: null.
export async function markNotificationsSeenAction(ids: string[]): Promise<ActionResult> {
  await markSeen(ids)
  revalidatePath('/', 'layout')
  return { success: true }
}
