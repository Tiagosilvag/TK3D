import { prisma } from '@/lib/prisma'
import { getProductVariantStockOptions } from '@/lib/reports'
import { resolveOrderItemColorLabel } from '@/actions/orders'
import { OrdersExplorer, type OrderRow } from './OrdersExplorer'
import { MarketplaceInboxSection } from './MarketplaceInboxSection'
import type { MarketplaceOrderInboxItem } from '@/lib/mercadoLivre/orders'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const [orders, variantProducts, filaments, pendingInbox, partners] = await Promise.all([
    prisma.order.findMany({
      orderBy: { deliveryDate: 'asc' },
      include: {
        items: {
          include: {
            product: true,
            reallocationsLost: { include: { toOrderItem: { include: { order: { select: { orderNumber: true } } } } }, orderBy: { createdAt: 'desc' } },
          },
        },
      },
    }),
    // Brinde nunca é vendido sozinho -- excluído do seletor (já filtrado
    // dentro de getProductVariantStockOptions).
    getProductVariantStockOptions(),
    // Bug "MULTFILA PRETO continua selecionável sem estoque": pra escolher
    // cor num pedido NOVO (diferente de Vendas/Entregas, que vendem peça
    // física já pronta -- aqui pode ser encomenda, produzida só depois),
    // filamento precisa ter estoque > 0 agora, produzida antes ou não (ver
    // filtro de `products` abaixo).
    prisma.filament.findMany({ select: { id: true, currentStockGrams: true } }),
    // Caixa de entrada de pedidos Mercado Livre (Task 10): linhas criadas
    // pelo webhook/poller (Tasks 7-9) esperando confirmação humana.
    prisma.marketplaceOrderInbox.findMany({ where: { status: 'PENDENTE' }, orderBy: { receivedAt: 'asc' } }),
    // Pedido do usuário "criar pedidos de encomendas de consignados
    // também": seletor de parceiro em "Novo pedido", só ativo.
    prisma.consignmentPartner.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  const filamentStockById = new Map(filaments.map((f) => [f.id, f.currentStockGrams.toNumber()]))

  // Mesmo dado (variantes por produto) alimenta o seletor do OrderForm E
  // a resolução de label/cor de cada item já registrado na tabela -- um
  // único fetch, dois usos.
  const variantByKey = new Map<string, { label: string; colorHex: string | null }>()
  for (const p of variantProducts) {
    for (const v of p.variants) variantByKey.set(`${p.productId}::${v.key}`, { label: v.label, colorHex: v.colorHex })
  }

  const products = variantProducts.map((p) => ({
    productId: p.productId,
    productName: p.productName,
    needsAssembly: p.needsAssembly,
    variants: p.variants
      .filter((v) => v.filamentIds === null || v.filamentIds.every((id) => (filamentStockById.get(id) ?? 0) > 0))
      .map((v) => ({ key: v.key, label: v.label, colorHex: v.colorHex, available: v.available })),
  }))

  // Bug "não mostra a cor da variação criada": variantByKey só cobre combo
  // JÁ PRODUZIDO (getProductVariantStockOptions) -- uma cor pedida via "+
  // Montar variação personalizada" mas nunca impressa não está lá.
  // Resolve pelo catálogo (resolveOrderItemColorLabel) só pros pares
  // (productId, colorComboKey) que faltaram, uma vez por par distinto.
  const missingPairs = new Map<string, { productId: string; colorComboKey: string }>()
  for (const o of orders) {
    for (const item of o.items) {
      if (!item.colorComboKey) continue
      const key = `${item.productId}::${item.colorComboKey}`
      if (!variantByKey.has(key)) missingPairs.set(key, { productId: item.productId, colorComboKey: item.colorComboKey })
    }
  }
  const fallbackEntries = await Promise.all(
    [...missingPairs.entries()].map(async ([key, { productId, colorComboKey }]) => [key, await resolveOrderItemColorLabel(productId, colorComboKey)] as const),
  )
  for (const [key, resolved] of fallbackEntries) {
    if (resolved) variantByKey.set(key, resolved)
  }

  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    orderDate: o.orderDate.toISOString(),
    deliveryDate: o.deliveryDate.toISOString(),
    channel: o.channel,
    buyerOrPlatform: o.buyerOrPlatform,
    notes: o.notes,
    items: o.items.map((item) => {
      const variant = item.colorComboKey ? variantByKey.get(`${item.productId}::${item.colorComboKey}`) : undefined
      return {
        id: item.id,
        productName: item.product.name,
        colorLabel: variant?.label ?? null,
        colorComboKey: item.colorComboKey,
        colorHex: variant?.colorHex ?? null,
        quantity: item.quantity,
        reservedQuantity: item.reservedQuantity,
        unitPrice: item.unitPrice.toNumber(),
        status: item.status,
        saleId: item.saleId,
        consignmentDeliveryId: item.consignmentDeliveryId,
        reallocationsLost: item.reallocationsLost.map((r) => ({
          quantity: r.quantity,
          toOrderNumber: r.toOrderItem.order.orderNumber,
          createdAt: r.createdAt.toISOString(),
        })),
      }
    }),
  }))

  const pendingOrders = pendingInbox.map((inbox) => ({
    id: inbox.id,
    externalOrderId: inbox.externalOrderId,
    buyerName: inbox.buyerName,
    totalAmount: inbox.totalAmount.toNumber(),
    items: inbox.items as unknown as MarketplaceOrderInboxItem[],
  }))

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Pedidos</h1>
      <MarketplaceInboxSection pendingOrders={pendingOrders} products={products} />
      <OrdersExplorer rows={rows} products={products} partners={partners} />
    </div>
  )
}
