import { prisma } from '@/lib/prisma'
import { getProductVariantStockOptions } from '@/lib/reports'
import { OrdersExplorer, type OrderRow } from './OrdersExplorer'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const [orders, variantProducts] = await Promise.all([
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
  ])

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
    variants: p.variants.map((v) => ({ key: v.key, label: v.label, colorHex: v.colorHex, available: v.available })),
  }))

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
        colorHex: variant?.colorHex ?? null,
        quantity: item.quantity,
        reservedQuantity: item.reservedQuantity,
        unitPrice: item.unitPrice.toNumber(),
        status: item.status,
        saleId: item.saleId,
        reallocationsLost: item.reallocationsLost.map((r) => ({
          quantity: r.quantity,
          toOrderNumber: r.toOrderItem.order.orderNumber,
          createdAt: r.createdAt.toISOString(),
        })),
      }
    }),
  }))

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Pedidos</h1>
      <OrdersExplorer rows={rows} products={products} />
    </div>
  )
}
