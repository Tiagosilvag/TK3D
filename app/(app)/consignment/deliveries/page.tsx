import { prisma } from '@/lib/prisma'
import { DeliveriesExplorer, type DeliveryBatchRow } from './DeliveriesExplorer'
import { resolveDateRange } from '@/lib/dateRange'
import { getProductVariantStockOptions, getProductVariantBreakdown } from '@/lib/reports'
import { productNeedsAssembly } from '@/lib/products'

export const dynamic = 'force-dynamic'

export default async function ConsignmentDeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; partnerId?: string; from?: string; to?: string }>
}) {
  const { productId, partnerId, from, to } = await searchParams
  const range = resolveDateRange({ from, to })

  const [deliveries, partners, deliveryOptions] = await Promise.all([
    prisma.consignmentDelivery.findMany({
      where: {
        deliveryDate: { gte: range.gte, lte: range.lte },
        ...(partnerId ? { partnerId } : {}),
      },
      orderBy: { deliveryDate: 'desc' },
      include: { partner: true, product: true },
    }),
    prisma.consignmentPartner.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getProductVariantStockOptions(),
  ])

  // Melhoria "Entregas em consignação" §5: rótulo de cor de cada linha --
  // reaproveita a mesma quebra de variante que Estoque/Parceiros já usam
  // (getProductVariantBreakdown), pra "Rosa"/"Azul" aqui bater com o resto
  // do app. Produto que hoje é inativo (soft-deleted) não entra em
  // getProductDeliveryOptions (só ativos) -- calcula à parte pra não perder
  // o rótulo de uma entrega histórica de um produto já removido.
  const productIdsInDeliveries = [...new Set(deliveries.map((d) => d.productId))]
  const labelByProductAndKey = new Map<string, { label: string; colorHex: string | null }>()
  for (const opt of deliveryOptions) {
    for (const v of opt.variants) labelByProductAndKey.set(`${opt.productId}::${v.key}`, { label: v.label, colorHex: v.colorHex })
  }
  const missingProductIds = productIdsInDeliveries.filter((id) => !deliveryOptions.some((o) => o.productId === id))
  if (missingProductIds.length > 0) {
    const missingProducts = await prisma.product.findMany({
      where: { id: { in: missingProductIds } },
      include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
    })
    await Promise.all(missingProducts.map(async (p) => {
      const needsAssembly = productNeedsAssembly({
        isComposite: p.isComposite,
        accessoryUsagesCount: p._count.accessoryUsages,
        supplyUsagesCount: p._count.supplyUsages,
        componentUsagesCount: p._count.componentUsages,
      })
      const breakdown = await getProductVariantBreakdown(p.id, needsAssembly)
      for (const v of breakdown) labelByProductAndKey.set(`${p.id}::${v.key}`, { label: v.label, colorHex: v.colorHex })
    }))
  }

  // Agrupa por batchId (item 4) -- uma linha por evento de entrega.
  const batchesMap = new Map<string, DeliveryBatchRow>()
  for (const d of deliveries) {
    const batch = batchesMap.get(d.batchId) ?? {
      batchId: d.batchId,
      partnerName: d.partner.name,
      deliveryDate: d.deliveryDate.toISOString(),
      items: [],
    }
    const variantInfo = d.colorComboKey ? labelByProductAndKey.get(`${d.productId}::${d.colorComboKey}`) : undefined
    batch.items.push({
      id: d.id,
      productName: d.product.name,
      colorLabel: variantInfo?.label ?? (d.colorComboKey ? d.colorComboKey : null),
      colorHex: variantInfo?.colorHex ?? null,
      quantityDelivered: d.quantityDelivered,
      unitPrice: d.unitPrice.toNumber(),
    })
    batchesMap.set(d.batchId, batch)
  }
  // findMany já veio ordenado por deliveryDate desc -- Map preserva a ordem
  // de primeira inserção, então os batches já saem na ordem certa.
  const batches = [...batchesMap.values()]

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Entregas em consignação</h1>

      {/* Melhoria "Entregas em consignação" §5: filtro por parceiro, além do
          período que já existia -- form GET simples, sem JS, mesmo padrão
          do resto do app. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 tk-panel p-3">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Parceiro
          <select name="partnerId" defaultValue={partnerId ?? ''} className="tk-input-full mt-1">
            <option value="">Todos parceiros</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          De
          <input type="date" name="from" defaultValue={range.from} className="tk-input-full mt-1" />
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Até
          <input type="date" name="to" defaultValue={range.to} className="tk-input-full mt-1" />
        </label>
        <button type="submit" className="rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:from-violet-500 dark:to-fuchsia-500 dark:text-slate-950">
          Filtrar
        </button>
        <a href="/consignment/deliveries" className="text-sm font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400">
          Últimos 30 dias
        </a>
      </form>

      <DeliveriesExplorer
        batches={batches}
        partners={partners.map((p) => ({ id: p.id, name: p.name }))}
        products={deliveryOptions}
        defaultProductId={productId}
      />
    </div>
  )
}
