import { prisma } from '@/lib/prisma'
import { getOwnStockSummary, getProductVariantBreakdown } from '@/lib/reports'
import { getAssemblyOverview } from '@/actions/assembly'
import { StockExplorer, type StockRow } from './StockExplorer'
import { InfoTooltip } from './InfoTooltip'

export const dynamic = 'force-dynamic'

export default async function StockPage() {
  const [rows, assemblyOverview, settings, products, adjustments] = await Promise.all([
    getOwnStockSummary(),
    // Melhoria "Meu Estoque" §5: "Prontas p/ montar" É o mesmo número que
    // "Disponível para montagem" na tela de Montagem -- reaproveita a MESMA
    // fonte (getAssemblyOverview) em vez de uma segunda fórmula que
    // pudesse divergir.
    getAssemblyOverview(),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.product.findMany({
      where: { active: true },
      select: { id: true, category: true, photos: { where: { isCover: true }, select: { id: true }, take: 1 } },
    }),
    prisma.stockAdjustment.findMany({ where: { resourceType: 'PRODUCT' }, orderBy: { createdAt: 'desc' } }),
  ])

  // Quebra por variante de cor de "produzido" -- preservada da tela
  // anterior (getProductVariantBreakdown), só que agora aninhada dentro da
  // coluna "Produzido", que ficou discreta/de apoio (spec §4).
  const variantBreakdowns = await Promise.all(
    rows.map(async (r) => [r.productId, await getProductVariantBreakdown(r.productId, r.needsAssembly)] as const),
  )
  const variantBreakdownMap = new Map(variantBreakdowns)

  const readyToAssembleMap = new Map(assemblyOverview.map((o) => [o.productId, o.maxAssemblableUnits]))
  const productInfoMap = new Map(products.map((p) => [p.id, { category: p.category, coverPhotoId: p.photos[0]?.id ?? null }]))
  const adjustmentsByProduct = new Map<string, typeof adjustments>()
  for (const adj of adjustments) {
    const list = adjustmentsByProduct.get(adj.resourceId) ?? []
    list.push(adj)
    adjustmentsByProduct.set(adj.resourceId, list)
  }

  const threshold = settings.productLowStockThreshold

  const stockRows: StockRow[] = rows.map((r) => {
    const info = productInfoMap.get(r.productId)
    return {
      productId: r.productId,
      productName: r.productName,
      category: info?.category ?? '',
      isComposite: r.isComposite,
      needsAssembly: r.needsAssembly,
      coverPhotoId: info?.coverPhotoId ?? null,
      available: r.available,
      readyToAssemble: r.needsAssembly ? (readyToAssembleMap.get(r.productId) ?? 0) : null,
      consignado: r.consignmentRemaining,
      soldDirect: r.soldDirect,
      produced: r.produced,
      variantBreakdown: (variantBreakdownMap.get(r.productId) ?? []).map((v) => ({ label: v.label, quantity: v.quantity })),
      lowStock: r.available > 0 && r.available <= threshold,
      adjustments: (adjustmentsByProduct.get(r.productId) ?? []).map((a) => ({
        id: a.id,
        createdAt: a.createdAt.toISOString(),
        difference: a.difference.toNumber(),
        reason: a.reason,
        reasonNote: a.reasonNote,
      })),
    }
  })

  return (
    <div className="tk-page">
      <h1 className="tk-page-title mb-0 inline-block">Meu Estoque</h1>
      <InfoTooltip text="Disponível = produzido − vendido diretamente − entregue a parceiros (+ ajustes). Produto que precisa de montagem (composto, ou com insumo/acessório cadastrado) só soma ao estoque depois da montagem confirmada." />

      <div className="mt-4">
        <StockExplorer rows={stockRows} />
      </div>

      {stockRows.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto ativo cadastrado.
        </div>
      )}
    </div>
  )
}
