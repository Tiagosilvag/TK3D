import { prisma } from '@/lib/prisma'
import { getProductVariantStockOptions } from '@/lib/reports'
import { OrdersExplorer, type OrderRow } from './OrdersExplorer'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const [orders, variantProducts] = await Promise.all([
    prisma.order.findMany({
      orderBy: { deliveryDate: 'asc' },
      include: {
        product: true,
        reallocationsLost: { include: { toOrder: { select: { orderNumber: true } } }, orderBy: { createdAt: 'desc' } },
      },
    }),
    // Brinde nunca é vendido sozinho -- excluído do seletor (já filtrado
    // dentro de getProductVariantStockOptions).
    getProductVariantStockOptions(),
  ])

  // Mesmo dado (variantes por produto) alimenta o seletor do OrderForm E
  // a resolução de label/cor de cada pedido já registrado na tabela --
  // um único fetch, dois usos.
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

  const rows: OrderRow[] = orders.map((o) => {
    const variant = o.colorComboKey ? variantByKey.get(`${o.productId}::${o.colorComboKey}`) : undefined
    return {
      id: o.id,
      orderDate: o.orderDate.toISOString(),
      deliveryDate: o.deliveryDate.toISOString(),
      channel: o.channel,
      productName: o.product.name,
      colorLabel: variant?.label ?? null,
      colorHex: variant?.colorHex ?? null,
      quantity: o.quantity,
      reservedQuantity: o.reservedQuantity,
      unitPrice: o.unitPrice.toNumber(),
      buyerOrPlatform: o.buyerOrPlatform,
      orderNumber: o.orderNumber,
      status: o.status,
      saleId: o.saleId,
      reallocationsLost: o.reallocationsLost.map((r) => ({
        quantity: r.quantity,
        toOrderNumber: r.toOrder.orderNumber,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  })

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Pedidos</h1>
      <OrdersExplorer rows={rows} products={products} />
    </div>
  )
}
