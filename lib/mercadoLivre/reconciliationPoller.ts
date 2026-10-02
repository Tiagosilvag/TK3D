import { getConnectionStatus, getValidAccessToken } from '@/lib/mercadoLivre/connection'
import { searchRecentOrders, processOrderNotification } from '@/lib/mercadoLivre/orders'

const INTERVAL_MS = 5 * 60 * 1000
const LOOKBACK_MS = 15 * 60 * 1000

let intervalHandle: ReturnType<typeof setInterval> | null = null

export async function runReconciliationOnce(): Promise<void> {
  const connection = await getConnectionStatus()
  if (!connection || connection.status === 'DESCONECTADA') return

  const accessToken = await getValidAccessToken()
  const sinceISO = new Date(Date.now() - LOOKBACK_MS).toISOString()
  const orderIds = await searchRecentOrders(accessToken, connection.sellerId, sinceISO)

  for (const orderId of orderIds) {
    try {
      await processOrderNotification(orderId)
    } catch (err) {
      console.error(`[mercadoLivre] falha ao reconciliar pedido ${orderId}:`, err)
    }
  }
}

export function startMercadoLivreReconciliationPoller(): void {
  if (intervalHandle) return
  intervalHandle = setInterval(() => {
    runReconciliationOnce().catch((err) => console.error('[mercadoLivre] falha no ciclo de reconciliação:', err))
  }, INTERVAL_MS)
}
