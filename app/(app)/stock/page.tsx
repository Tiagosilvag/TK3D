import { prisma } from '@/lib/prisma'
import { getOwnStockSummary, getProductVariantBreakdown, getProductVariantStockOptions } from '@/lib/reports'
import { getAssemblyStatus, type AssemblyStatus } from '@/actions/assembly'
import { StockExplorer, type StockRow, type StockVariantRow } from './StockExplorer'
import { InfoTooltip } from './InfoTooltip'

export const dynamic = 'force-dynamic'

// Redesign "Estoque moderno": "Prontas p/ montar" POR VARIANTE de cor --
// decodifica a `key` de ProductVariantBreakdownRow (formato
// "partId:comboKey" ou, pra produto composto de várias peças,
// "partId1:combo1|partId2:combo2", ver lib/reports.ts#serializeColorChoices)
// de volta num Record<id, comboKey>, e cruza contra os colorOptions de cada
// peça/componente (actions/assembly.ts#getAssemblyStatus) -- disponível
// daquele combo específico ÷ quantityPerUnit, mínimo entre todas as
// peças/componentes. Peça sem cor variável (colorOptions null) contribui
// com seu maxUnits cego a cor de qualquer forma (é o mesmo em toda
// variante, já que não varia). Nunca inventa: combo não encontrado nos
// colorOptions da peça conta como 0 disponível daquele combo (conservador),
// nunca um valor positivo chutado.
function computeReadyToAssembleForVariant(status: AssemblyStatus, variantKey: string): number {
  const entities = [
    ...status.parts.map((p) => ({ id: p.partId, quantityPerUnit: p.quantityPerUnit, colorOptions: p.colorOptions, maxUnits: p.maxUnitsFromThisPart })),
    ...status.components.map((c) => ({ id: c.componentProductId, quantityPerUnit: c.quantityPerUnit, colorOptions: c.colorOptions, maxUnits: c.maxUnitsFromThisComponent })),
  ]
  if (entities.length === 0) return 0

  const parsedChoices = new Map<string, string>()
  for (const token of variantKey.split('|')) {
    const idx = token.indexOf(':')
    if (idx === -1) continue
    parsedChoices.set(token.slice(0, idx), token.slice(idx + 1))
  }

  let min = Infinity
  for (const e of entities) {
    if (e.colorOptions) {
      const chosenKey = parsedChoices.get(e.id)
      const option = chosenKey ? e.colorOptions.find((o) => o.key === chosenKey) : undefined
      const available = option?.available ?? 0
      min = Math.min(min, e.quantityPerUnit > 0 ? Math.floor(available / e.quantityPerUnit) : 0)
    } else {
      min = Math.min(min, e.maxUnits)
    }
  }
  return Math.max(0, min)
}

export default async function StockPage() {
  const [rows, settings, products, adjustments] = await Promise.all([
    getOwnStockSummary(),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.product.findMany({
      where: { active: true },
      select: { id: true, category: true, isComposite: true, photos: { where: { isCover: true }, select: { id: true }, take: 1 } },
    }),
    prisma.stockAdjustment.findMany({ where: { resourceType: 'PRODUCT' }, orderBy: { createdAt: 'desc' } }),
  ])

  // Quebra por variante de cor de "produzido" -- mesma fonte de sempre
  // (getProductVariantBreakdown), agora combinada com disponível (getProductVariantStockOptions)
  // e cruzada com Vendido/Consignado/Prontas-p/-montar por variante, tudo
  // dentro do objeto único `variants` que alimenta o modal "Ver variações".
  const [variantBreakdowns, variantStockOptions] = await Promise.all([
    Promise.all(rows.map(async (r) => [r.productId, await getProductVariantBreakdown(r.productId, r.needsAssembly)] as const)),
    getProductVariantStockOptions(),
  ])
  const variantBreakdownMap = new Map(variantBreakdowns)
  const availableByProductAndKey = new Map<string, number>()
  for (const opt of variantStockOptions) {
    for (const v of opt.variants) availableByProductAndKey.set(`${opt.productId}::${v.key}`, v.available)
  }

  const [soldByProductAndKey, deliveredByProductAndKey, saleReportsWithDelivery] = await Promise.all([
    prisma.sale.groupBy({ by: ['productId', 'colorComboKey'], _sum: { quantity: true } }),
    prisma.consignmentDelivery.groupBy({ by: ['productId', 'colorComboKey'], _sum: { quantityDelivered: true } }),
    prisma.consignmentSaleReport.findMany({ include: { delivery: { select: { productId: true, colorComboKey: true } } } }),
  ])
  const soldMap = new Map<string, number>()
  for (const s of soldByProductAndKey) {
    if (!s.colorComboKey) continue
    soldMap.set(`${s.productId}::${s.colorComboKey}`, s._sum.quantity ?? 0)
  }
  const deliveredMap = new Map<string, number>()
  for (const d of deliveredByProductAndKey) {
    if (!d.colorComboKey) continue
    deliveredMap.set(`${d.productId}::${d.colorComboKey}`, d._sum.quantityDelivered ?? 0)
  }
  const consignmentSoldMap = new Map<string, number>()
  for (const report of saleReportsWithDelivery) {
    if (!report.delivery.colorComboKey) continue
    const key = `${report.delivery.productId}::${report.delivery.colorComboKey}`
    consignmentSoldMap.set(key, (consignmentSoldMap.get(key) ?? 0) + report.quantitySold)
  }

  // Status de montagem completo (peças/componentes com colorOptions) só
  // pros produtos que passam por Montagem -- mesmo padrão N+1-em-paralelo
  // já aceito no resto do app (catálogo pequeno). Substitui getAssemblyOverview
  // (que faria a MESMA chamada por baixo dos panos) -- calcula o agregado
  // (maxAssemblableUnits) e a quebra por variante a partir do MESMO status,
  // uma única vez, em vez de duas fontes que pudessem divergir.
  const needsAssemblyRows = rows.filter((r) => r.needsAssembly)
  const assemblyStatuses = await Promise.all(needsAssemblyRows.map((r) => getAssemblyStatus(r.productId)))
  const statusByProductId = new Map(assemblyStatuses.map((s) => [s.productId, s]))

  const productInfoMap = new Map(products.map((p) => [p.id, { category: p.category, isComposite: p.isComposite, coverPhotoId: p.photos[0]?.id ?? null }]))
  const adjustmentsByProduct = new Map<string, typeof adjustments>()
  for (const adj of adjustments) {
    const list = adjustmentsByProduct.get(adj.resourceId) ?? []
    list.push(adj)
    adjustmentsByProduct.set(adj.resourceId, list)
  }

  const threshold = settings.productLowStockThreshold

  const stockRows: StockRow[] = rows.map((r) => {
    const info = productInfoMap.get(r.productId)
    const status = statusByProductId.get(r.productId)
    const producedBreakdown = variantBreakdownMap.get(r.productId) ?? []

    const knownVariants: StockVariantRow[] = producedBreakdown.map((v) => ({
      key: v.key,
      label: v.label,
      colorHex: v.colorHex,
      available: availableByProductAndKey.get(`${r.productId}::${v.key}`) ?? 0,
      readyToAssemble: status ? computeReadyToAssembleForVariant(status, v.key) : 0,
      consignado: Math.max(0, (deliveredMap.get(`${r.productId}::${v.key}`) ?? 0) - (consignmentSoldMap.get(`${r.productId}::${v.key}`) ?? 0)),
      sold: soldMap.get(`${r.productId}::${v.key}`) ?? 0,
    }))

    // Melhoria "Estoque moderno": produzido/vendido/consignado por variante
    // podem, cada um independentemente, ter uma sobra não atribuída a
    // nenhuma variante conhecida (montagem/venda anterior ao rastreamento
    // de cor, ou produto cujas peças nunca tiveram cor variável) -- nunca
    // inventa qual variante é, só torna a sobra explícita como "Sem cor
    // registrada" no modal (disponível dessa sobra = produzido − vendido −
    // consignado da PRÓPRIA sobra, mesma fórmula do agregado, nunca uma
    // peça física rastreada; "Prontas p/ montar" não tem como ser
    // atribuída a essa sobra -- fica null, mostrado como "—").
    const producedSumKnown = knownVariants.reduce((s, v) => s + producedBreakdown.find((p) => p.key === v.key)!.quantity, 0)
    const soldSumKnown = knownVariants.reduce((s, v) => s + v.sold, 0)
    const consignadoSumKnown = knownVariants.reduce((s, v) => s + v.consignado, 0)
    const producedRemainder = Math.max(0, r.produced - producedSumKnown)
    const soldRemainder = Math.max(0, r.soldDirect - soldSumKnown)
    const consignadoRemainder = Math.max(0, r.consignmentRemaining - consignadoSumKnown)

    const variants: StockVariantRow[] = knownVariants.length > 0 && (producedRemainder > 0 || soldRemainder > 0 || consignadoRemainder > 0)
      ? [...knownVariants, {
          key: '__unknown__',
          label: 'Sem cor registrada',
          colorHex: null,
          available: Math.max(0, producedRemainder - soldRemainder - consignadoRemainder),
          readyToAssemble: null,
          consignado: consignadoRemainder,
          sold: soldRemainder,
        }]
      : knownVariants

    return {
      productId: r.productId,
      productName: r.productName,
      category: info?.category ?? '',
      isComposite: info?.isComposite ?? r.isComposite,
      needsAssembly: r.needsAssembly,
      coverPhotoId: info?.coverPhotoId ?? null,
      available: r.available,
      readyToAssemble: r.needsAssembly ? (status?.maxAssemblableUnits ?? 0) : null,
      consignado: r.consignmentRemaining,
      soldDirect: r.soldDirect,
      lowStock: r.available > 0 && r.available <= threshold,
      variants,
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
      <h1 className="tk-page-title mb-0 inline-block">Estoque</h1>
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
