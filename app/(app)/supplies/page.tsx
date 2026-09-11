import { prisma } from '@/lib/prisma'
import { formatUnitCost } from '@/lib/format'
import { getStockStatusWithThresholds, calculateStockReferenceQuantity, calculateStockPercentRemaining } from '@/lib/costing'
import { SuppliesExplorer, type SupplyRow } from './SuppliesExplorer'
import { RestockForm } from './RestockForm'
import type { SupplyUnit } from '@prisma/client'

export const dynamic = 'force-dynamic'

const SUPPLY_UNIT_LABELS: Record<SupplyUnit, string> = {
  UN: 'Unidade',
  ML: 'Mililitro',
  G: 'Grama',
  M: 'Metro',
  OUTRO: 'Outro',
}

export default async function SuppliesPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams

  const [supplies, settings, editingSupplyRecord] = await Promise.all([
    prisma.supply.findMany({
      include: { purchases: { orderBy: { purchaseDate: 'desc' } } },
      orderBy: { name: 'asc' },
    }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    editId ? prisma.supply.findUnique({ where: { id: editId } }) : null,
  ])

  // 2.6: histórico de ajustes de estoque, agrupado por insumo -- exibido
  // junto do histórico de reposições já existente na mesma <details>.
  const adjustments = await prisma.stockAdjustment.findMany({
    where: { resourceType: 'SUPPLY', resourceId: { in: supplies.map((s) => s.id) } },
    orderBy: { createdAt: 'desc' },
  })
  const adjustmentsBySupply = new Map<string, typeof adjustments>()
  for (const adj of adjustments) {
    const list = adjustmentsBySupply.get(adj.resourceId) ?? []
    list.push(adj)
    adjustmentsBySupply.set(adj.resourceId, list)
  }

  // Melhoria "Histórico de consumo": mesma lógica de agrupamento dos
  // ajustes acima, agora pra StockConsumption (actions/stockConsumptions.ts) --
  // toda baixa de insumo feita por confirmAssembly desde essa melhoria.
  const consumptions = await prisma.stockConsumption.findMany({
    where: { resourceType: 'SUPPLY', resourceId: { in: supplies.map((s) => s.id) } },
    include: { product: { select: { name: true } } },
    orderBy: { consumedAt: 'desc' },
  })
  const consumptionsBySupply = new Map<string, typeof consumptions>()
  for (const c of consumptions) {
    const list = consumptionsBySupply.get(c.resourceId) ?? []
    list.push(c)
    consumptionsBySupply.set(c.resourceId, list)
  }

  const editingSupply = editingSupplyRecord
    ? {
        id: editingSupplyRecord.id,
        name: editingSupplyRecord.name,
        unit: editingSupplyRecord.unit,
        defaultUsage: editingSupplyRecord.defaultUsage?.toNumber() ?? null,
      }
    : undefined

  const lowThresholdPercent = settings.stockLowThresholdPercent.toNumber()
  const criticalThresholdPercent = settings.stockCriticalThresholdPercent.toNumber()

  // percentRemaining (Fix 2, task-10 brief) = currentStock sobre a MÉDIA DAS
  // ÚLTIMAS N COMPRAS (lib/costing.ts#calculateStockReferenceQuantity), não
  // mais "total já comprado" -- mesmo cálculo e mesmo raciocínio de
  // Accessory (ver comentário lá): dividir pelo total histórico decaía pra
  // zero em qualquer item de giro rápido. `s.purchases` já vem ordenado por
  // purchaseDate desc (query acima).
  const allRows = supplies.map((s) => {
    const currentStock = s.currentStock.toNumber()
    const avgUnitCost = s.avgUnitCost.toNumber()
    const referenceQuantity = calculateStockReferenceQuantity(s.purchases.map((p) => p.quantity.toNumber()))
    const percentRemaining = calculateStockPercentRemaining(currentStock, referenceQuantity)
    const valueInStock = currentStock * avgUnitCost
    const status = getStockStatusWithThresholds(percentRemaining, lowThresholdPercent, criticalThresholdPercent)
    return { supply: s, currentStock, avgUnitCost, percentRemaining, valueInStock, status }
  })

  const mainRows = allRows.filter((r) => r.currentStock > 0)
  const esgotadosRows = allRows.filter((r) => r.currentStock <= 0)

  // Melhoria "Insumos": busca/filtro por unidade/baixo-estoque viram
  // interativos no navegador (SuppliesExplorer) -- rows já vem com
  // histórico (compras/ajustes/consumo) embutido por item, mesmo padrão
  // de PackagingRow (packaging/page.tsx).
  const rows: SupplyRow[] = mainRows.map(({ supply: s, currentStock, avgUnitCost, valueInStock, percentRemaining, status }) => ({
    id: s.id,
    name: s.name,
    unit: s.unit,
    currentStock,
    avgUnitCost,
    valueInStock,
    percentRemaining,
    defaultUsage: s.defaultUsage?.toNumber() ?? null,
    status,
    purchases: s.purchases.map((p) => ({
      id: p.id,
      purchaseDate: p.purchaseDate.toISOString(),
      quantity: p.quantity.toNumber(),
      totalCost: p.totalCost.toNumber(),
    })),
    adjustments: (adjustmentsBySupply.get(s.id) ?? []).map((adj) => ({
      id: adj.id,
      createdAt: adj.createdAt.toISOString(),
      difference: adj.difference.toNumber(),
      reason: adj.reason,
      reasonNote: adj.reasonNote,
    })),
    consumptionHistory: (consumptionsBySupply.get(s.id) ?? []).map((c) => ({
      id: c.id,
      consumedAt: c.consumedAt.toISOString(),
      quantity: c.quantity.toNumber(),
      productName: c.product.name,
      source: c.source,
    })),
  }))

  // Cards de resumo (mirroring Accessory's task-3 brief): sempre sobre o
  // conjunto completo, independente dos filtros de unidade/estoque
  // aplicados na listagem abaixo.
  const totalValueInStock = allRows.reduce((sum, r) => sum + r.valueInStock, 0)
  const countByStatus = allRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status.label] = (acc[r.status.label] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="tk-page">
      <SuppliesExplorer rows={rows} editingSupply={editingSupply} summary={{ totalValueInStock, countByStatus }} />

      {esgotadosRows.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Insumos esgotados ({esgotadosRows.length})</summary>
          {/* Fix 1 (task-10 brief): esgotados não podem ser excluídos (guarda em
              deleteSupply) -- o botão de excluir some desta seção porque a
              ação sempre recusaria, sem oferecer uma opção que nunca funciona. */}
          <table className="tk-table-zebra mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Nome</th>
                <th>Unidade</th>
                <th>Custo por unidade</th>
                <th>Repor estoque</th>
              </tr>
            </thead>
            <tbody>
              {esgotadosRows.map(({ supply: s, avgUnitCost }) => (
                <tr key={s.id} className="tk-row-inactive">
                  <td className="py-2">{s.name}</td>
                  <td>{SUPPLY_UNIT_LABELS[s.unit] ?? s.unit}</td>
                  <td>{formatUnitCost(s.unit, avgUnitCost)}</td>
                  <td>
                    <RestockForm supplyId={s.id} supplyName={s.name} />
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
