import { prisma } from '@/lib/prisma'
import { calculateStockReferenceQuantity, calculateStockPercentRemaining } from '@/lib/costing'
import { FilamentsExplorer, type FilamentRow } from './FilamentsExplorer'
import { RestockForm } from './RestockForm'
import { FilamentHistoryButton, type FilamentPurchaseEntry, type FilamentAdjustmentEntry, type FilamentConsumptionEntry } from './FilamentHistoryButton'

export const dynamic = 'force-dynamic'

export default async function FilamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams

  const [allFilaments, editingFilamentRecord] = await Promise.all([
    prisma.filament.findMany({
      include: { purchases: { orderBy: { purchaseDate: 'desc' } } },
      orderBy: [{ manufacturer: 'asc' }, { colorName: 'asc' }],
    }),
    editId ? prisma.filament.findUnique({ where: { id: editId } }) : null,
  ])

  const allFilamentIds = allFilaments.map((f) => f.id)

  // 2.6: histórico de ajustes de estoque, agrupado por filamento -- exibido
  // junto do histórico de compras/consumo dentro do modal de histórico
  // (FilamentHistoryButton.tsx).
  const adjustments = await prisma.stockAdjustment.findMany({
    where: { resourceType: 'FILAMENT', resourceId: { in: allFilamentIds } },
    orderBy: { createdAt: 'desc' },
  })
  const adjustmentsByFilament = new Map<string, typeof adjustments>()
  for (const adj of adjustments) {
    const list = adjustmentsByFilament.get(adj.resourceId) ?? []
    list.push(adj)
    adjustmentsByFilament.set(adj.resourceId, list)
  }

  // Melhoria "Histórico de consumo": filamento já tem consumo totalmente
  // rastreado via ProductionRun (nunca apagado, mesmo depois de esgotar) --
  // busca todos os lotes relevantes pra QUALQUER filamento (não só os em
  // estoque -- bug "perde histórico de consumo quando esgota") NUMA query
  // só (evita N+1), depois agrupa em memória. `filamentUsages: true` (sem
  // filtro) porque um lote multi-filamento pode ter componentes de VÁRIOS
  // filamentos diferentes ao mesmo tempo -- filtra por filamento no loop
  // abaixo, não na query.
  const relevantRuns = allFilamentIds.length > 0
    ? await prisma.productionRun.findMany({
        where: {
          status: { not: 'CANCELADA' },
          OR: [
            { filamentId: { in: allFilamentIds } },
            { filamentUsages: { some: { filamentId: { in: allFilamentIds } } } },
          ],
        },
        include: {
          product: { select: { name: true } },
          productPart: { select: { name: true } },
          filamentUsages: true,
        },
        orderBy: { date: 'desc' },
      })
    : []

  const historyByFilament = new Map<string, FilamentConsumptionEntry[]>()
  function pushHistoryEntry(filamentId: string, entry: FilamentConsumptionEntry) {
    const list = historyByFilament.get(filamentId) ?? []
    list.push(entry)
    historyByFilament.set(filamentId, list)
  }
  for (const run of relevantRuns) {
    if (run.filamentUsages.length > 0) {
      for (const usage of run.filamentUsages) {
        if (!allFilamentIds.includes(usage.filamentId)) continue
        pushHistoryEntry(usage.filamentId, {
          id: `${run.id}-${usage.id}`,
          date: run.date.toISOString(),
          productName: run.product.name,
          partName: run.productPart?.name ?? null,
          gramsUsed: usage.gramsUsed.toNumber(),
          gramsWasted: usage.gramsWasted.toNumber(),
        })
      }
    } else if (allFilamentIds.includes(run.filamentId)) {
      pushHistoryEntry(run.filamentId, {
        id: run.id,
        date: run.date.toISOString(),
        productName: run.product.name,
        partName: run.productPart?.name ?? null,
        gramsUsed: run.gramsUsed.toNumber(),
        gramsWasted: run.gramsWasted.toNumber(),
      })
    }
  }

  const editingFilament = editingFilamentRecord
    ? {
        id: editingFilamentRecord.id,
        manufacturer: editingFilamentRecord.manufacturer,
        material: editingFilamentRecord.material,
        colorName: editingFilamentRecord.colorName,
        colorHex: editingFilamentRecord.colorHex,
      }
    : undefined

  // percentRemaining (mesmo raciocínio de lib/costing.ts#calculateStockReferenceQuantity
  // já usado por Accessory/Supply): currentStockGrams sobre a MÉDIA DAS
  // ÚLTIMAS N COMPRAS, não mais "peso do rolo" (que não existe mais --
  // um filamento pode ter N compras de tamanhos diferentes ao longo do
  // tempo). `f.purchases` já vem ordenado por purchaseDate desc.
  const allRows = allFilaments.map((f) => {
    const currentStockGrams = f.currentStockGrams.toNumber()
    const pricePerGram = f.avgUnitCostPerGram.toNumber()
    const referenceQuantity = calculateStockReferenceQuantity(f.purchases.map((p) => p.weightGrams.toNumber()))
    const percentRemaining = calculateStockPercentRemaining(currentStockGrams, referenceQuantity)
    const lastPurchase = f.purchases[0]
    const lastPricePerKg = lastPurchase ? (lastPurchase.totalCost.toNumber() / lastPurchase.weightGrams.toNumber()) * 1000 : null

    const purchases: FilamentPurchaseEntry[] = f.purchases.map((p) => ({
      id: p.id,
      purchaseDate: p.purchaseDate.toISOString(),
      weightGrams: p.weightGrams.toNumber(),
      totalCost: p.totalCost.toNumber(),
    }))
    const rowAdjustments: FilamentAdjustmentEntry[] = (adjustmentsByFilament.get(f.id) ?? []).map((adj) => ({
      id: adj.id,
      createdAt: adj.createdAt.toISOString(),
      difference: adj.difference.toNumber(),
      reason: adj.reason,
      reasonNote: adj.reasonNote,
    }))
    const consumptionHistory = historyByFilament.get(f.id) ?? []

    return { filament: f, currentStockGrams, pricePerGram, lastPricePerKg, percentRemaining, purchases, adjustments: rowAdjustments, consumptionHistory }
  })

  const mainRows = allRows.filter((r) => r.currentStockGrams > 0)
  const esgotadosRows = allRows.filter((r) => r.currentStockGrams <= 0)

  const rows: FilamentRow[] = mainRows.map((r) => ({
    id: r.filament.id,
    manufacturer: r.filament.manufacturer,
    material: r.filament.material,
    colorName: r.filament.colorName,
    colorHex: r.filament.colorHex,
    currentStockGrams: r.currentStockGrams,
    pricePerGram: r.pricePerGram,
    lastPricePerKg: r.lastPricePerKg,
    percentRemaining: r.percentRemaining,
    purchases: r.purchases,
    adjustments: r.adjustments,
    consumptionHistory: r.consumptionHistory,
  }))

  return (
    <div className="tk-page">
      <FilamentsExplorer rows={rows} editingFilament={editingFilament} />

      {esgotadosRows.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Filamentos esgotados ({esgotadosRows.length})</summary>
          {/* Filamento esgotado não pode ser excluído (guarda em
              deleteFilament, mesma regra de deleteAccessory) -- o botão de
              excluir some desta seção porque a ação sempre recusaria, sem
              oferecer uma opção que nunca funciona. Repor estoque/Histórico
              continuam disponíveis (bug "perde histórico ao esgotar"). */}
          <table className="tk-table-zebra mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2"></th>
                <th>Marca</th>
                <th>Material</th>
                <th>Estoque atual (g)</th>
                <th>R$/g</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {esgotadosRows.map((r) => (
                <tr key={r.filament.id} className="tk-row-inactive">
                  <td className="py-2">
                    <span style={{ background: r.filament.colorHex }} className="inline-block h-3 w-3 rounded-full" />
                  </td>
                  <td>{r.filament.manufacturer} {r.filament.colorName}</td>
                  <td>{r.filament.material}</td>
                  <td>{r.currentStockGrams}g</td>
                  <td>{r.pricePerGram > 0 ? `R$ ${r.pricePerGram.toFixed(4)}` : '—'}</td>
                  <td>
                    <RestockForm filamentId={r.filament.id} filamentName={`${r.filament.manufacturer} ${r.filament.colorName}`} />
                  </td>
                  <td>
                    <FilamentHistoryButton
                      filamentName={`${r.filament.manufacturer} ${r.filament.colorName}`}
                      purchases={r.purchases}
                      adjustments={r.adjustments}
                      consumptionHistory={r.consumptionHistory}
                      className="text-xs text-violet-600 hover:underline dark:text-violet-400"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
