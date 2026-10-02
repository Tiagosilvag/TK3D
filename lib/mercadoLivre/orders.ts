import { prisma } from '@/lib/prisma'
import { getValidAccessToken } from '@/lib/mercadoLivre/connection'
import { createNotification } from '@/lib/notifications'

export interface MLOrderPayload {
  id: number
  buyer?: { nickname?: string }
  total_amount: number
  order_items: Array<{
    item: { id: string; title: string; seller_sku: string | null }
    quantity: number
    unit_price: number
  }>
}

export interface MarketplaceOrderInboxItem {
  externalItemId: string
  title: string
  sku: string | null
  quantity: number
  unitPrice: number
}

export async function fetchOrderFromApi(accessToken: string, orderId: string): Promise<MLOrderPayload> {
  const response = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Falha ao buscar pedido ${orderId} no Mercado Livre`)
  return response.json()
}

export async function searchRecentOrders(accessToken: string, sellerId: string, sinceISO: string): Promise<string[]> {
  const params = new URLSearchParams({ seller: sellerId, 'order.date_created.from': sinceISO })
  const response = await fetch(`https://api.mercadolibre.com/orders/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error('Falha ao buscar pedidos recentes no Mercado Livre')
  const data = (await response.json()) as { results: Array<{ id: number }> }
  return data.results.map((r) => String(r.id))
}

export function normalizeOrderItems(payload: MLOrderPayload): MarketplaceOrderInboxItem[] {
  return payload.order_items.map((orderItem) => ({
    externalItemId: orderItem.item.id,
    title: orderItem.item.title,
    sku: orderItem.item.seller_sku,
    quantity: orderItem.quantity,
    unitPrice: orderItem.unit_price,
  }))
}

export async function processOrderNotification(externalOrderId: string): Promise<void> {
  const accessToken = await getValidAccessToken()
  const payload = await fetchOrderFromApi(accessToken, externalOrderId)
  const items = normalizeOrderItems(payload)

  const existing = await prisma.marketplaceOrderInbox.findUnique({
    where: { platform_externalOrderId: { platform: 'MERCADO_LIVRE', externalOrderId: String(payload.id) } },
  })

  const inbox = await prisma.marketplaceOrderInbox.upsert({
    where: { platform_externalOrderId: { platform: 'MERCADO_LIVRE', externalOrderId: String(payload.id) } },
    create: {
      platform: 'MERCADO_LIVRE',
      externalOrderId: String(payload.id),
      buyerName: payload.buyer?.nickname ?? null,
      totalAmount: payload.total_amount,
      items: items as unknown as object,
    },
    update: {
      buyerName: payload.buyer?.nickname ?? null,
      totalAmount: payload.total_amount,
      items: items as unknown as object,
    },
  })

  if (!existing) {
    await createNotification({
      type: 'NOVO_PEDIDO_MARKETPLACE',
      title: 'Novo pedido no Mercado Livre',
      body: `Pedido #${inbox.externalOrderId} — ${items.length} item(ns)`,
      link: '/orders',
      resourceType: 'MarketplaceOrderInbox',
      resourceId: inbox.id,
    })
  }
}
