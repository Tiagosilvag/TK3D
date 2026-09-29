import { prisma } from '@/lib/prisma'
import { getProductVariantStockOptions } from '@/lib/reports'
import { resolveOrderItemColorLabel } from '@/actions/orders'
import { OrdersExplorer, type OrderRow } from './OrdersExplorer'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const [orders, variantProducts, filaments] = await Promise.all([
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
