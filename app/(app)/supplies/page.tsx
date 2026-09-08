import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency, formatUnitCost, getStockStatusBadge, STOCK_ADJUSTMENT_REASON_LABELS } from '@/lib/format'
import { getStockStatusWithThresholds, calculateStockReferenceQuantity, calculateStockPercentRemaining } from '@/lib/costing'
import { SupplyForm } from './SupplyForm'
import { RestockForm } from './RestockForm'
import { deleteSupply } from '@/actions/supplies'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { StatusBadge } from '@/components/StatusBadge'
import type { SupplyUnit } from '@prisma/client'

export const dynamic = 'force-dynamic'

const SUPPLY_UNIT_LABELS: Record<SupplyUnit, string> = {
  UN: 'Unidade',
  ML: 'Mililitro',
  G: 'Grama',
  M: 'Metro',
  OUTRO: 'Outro',
}

const UNIT_FILTERS: { value: SupplyUnit | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  { value: 'UN', label: 'Unidade' },
  { value: 'ML', label: 'Mililitro' },
  { value: 'G', label: 'Grama' },
  { value: 'M', label: 'Metro' },
  { value: 'OUTRO', label: 'Outro' },
]

function buildHref(params: { unit?: string; stock?: string }): string {
  const qs = new URLSearchParams()
  if (params.unit) qs.set('unit', params.unit)
  if (params.stock) qs.set('stock', params.stock)
  const s = qs.toString()
  return s ? `/supplies?${s}` : '/supplies'
}

function tabClass(isActive: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR')
}

export default async function SuppliesPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; stock?: string; editId?: string }>
}) {
  const { unit, stock, editId } = await searchParams
  const activeUnit = (['UN', 'ML', 'G', 'M', 'OUTRO'] as const).includes(unit as SupplyUnit)
    ? (unit as SupplyUnit)
    : undefined
  const activeStock = stock === 'baixo' ? 'baixo' : undefined

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

  const editingSupply = editingSupplyRecord
    ? { id: editingSupplyRecord.id, name: editingSupplyRecord.name, unit: editingSupplyRecord.unit }
    : undefined

  const lowThresholdPercent = settings.stockLowThresholdPercent.toNumber()
  const criticalThresholdPercent = settings.stockCriticalThresholdPercent.toNumber()

  // percentRemaining (Fix 2, task-10 brief) = currentStock sobre a MÉDIA DAS
  // ÚLTIMAS N COMPRAS (lib/costing.ts#calculateStockReferenceQuantity), não
  // mais "total já comprado" -- mesmo cálculo e mesmo raciocínio de
  // Accessory (ver comentário lá): dividir pelo total histórico decaía pra
  // zero em qualquer item de giro rápido. `s.purchases` já vem ordenado por
  // purchaseDate desc (query acima).
  const rows = supplies.map((s) => {
    const currentStock = s.currentStock.toNumber()
    const avgUnitCost = s.avgUnitCost.toNumber()
    const referenceQuantity = calculateStockReferenceQuantity(s.purchases.map((p) => p.quantity.toNumber()))
    const percentRemaining = calculateStockPercentRemaining(currentStock, referenceQuantity)
    const valueInStock = currentStock * avgUnitCost
    const status = getStockStatusWithThresholds(percentRemaining, lowThresholdPercent, criticalThresholdPercent)
    return { supply: s, currentStock, avgUnitCost, percentRemaining, valueInStock, status }
  })

  const mainRows = rows.filter((r) => r.currentStock > 0)
  const esgotadosRows = rows.filter((r) => r.currentStock <= 0)

  const filteredMainRows = mainRows
    .filter((r) => (activeUnit ? r.supply.unit === activeUnit : true))
    .filter((r) => (activeStock === 'baixo' ? r.percentRemaining > 0 && r.percentRemaining <= lowThresholdPercent * 100 : true))

  // Cards de resumo (mirroring Accessory's task-3 brief): sempre sobre o
  // conjunto completo, independente dos filtros de unidade/estoque
  // aplicados na listagem abaixo.
  const totalValueInStock = rows.reduce((sum, r) => sum + r.valueInStock, 0)
  const countByStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status.label] = (acc[r.status.label] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Insumos</h1>
      <SupplyForm key={editingSupply?.id ?? 'new'} editingSupply={editingSupply} />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Valor total em estoque</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalValueInStock)}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🟢 Em estoque</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countByStatus['Em estoque'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🟡 Estoque baixo</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countByStatus['Estoque baixo'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🔴 Estoque crítico</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countByStatus['Estoque crítico'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">⚫ Esgotados</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countByStatus['Esgotado'] ?? 0}</p>
        </div>
      </div>

      <div className="mb-2 mt-6 flex flex-wrap gap-1">
        {UNIT_FILTERS.map((f) => (
          <Link key={f.label} href={buildHref({ unit: f.value, stock: activeStock })} className={tabClass(activeUnit === f.value)}>
            {f.label}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        <Link href={buildHref({ unit: activeUnit })} className={tabClass(!activeStock)}>
          Todos
        </Link>
        <Link href={buildHref({ unit: activeUnit, stock: 'baixo' })} className={tabClass(activeStock === 'baixo')}>
          Estoque baixo
        </Link>
      </div>

      <table className="tk-table-zebra mt-2 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Nome</th>
            <th>Unidade</th>
            <th>Estoque</th>
            <th>Custo por unidade</th>
            <th>Valor em estoque</th>
            <th>% restante</th>
            <th>Status</th>
            <th>Repor estoque</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filteredMainRows.map(({ supply: s, currentStock, avgUnitCost, valueInStock, percentRemaining, status }) => (
            <tr key={s.id} className="tk-row align-top">
              <td className="py-2">{s.name}</td>
              <td>{SUPPLY_UNIT_LABELS[s.unit] ?? s.unit}</td>
              <td>{currentStock}</td>
              <td>{formatUnitCost(s.unit, avgUnitCost)}</td>
              <td>{formatCurrency(valueInStock)}</td>
              <td>{percentRemaining.toFixed(1)}%</td>
              <td><StatusBadge badge={getStockStatusBadge(status)} /></td>
              <td>
                <RestockForm supplyId={s.id} supplyName={s.name} />
              </td>
              <td>
                <div className="flex flex-col items-start gap-1">
                  <details>
                    <summary className="tk-summary">Histórico ({s.purchases.length})</summary>
                    <table className="mt-2 text-xs">
                      <thead>
                        <tr className="tk-table-head-row">
                          <th className="pr-2">Data</th>
                          <th className="pr-2">Qtd</th>
                          <th className="pr-2">Valor total</th>
                          <th>R$/un</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.purchases.map((p) => (
                          <tr key={p.id} className="tk-row">
                            <td className="pr-2">{formatDate(p.purchaseDate)}</td>
                            <td className="pr-2">{p.quantity.toNumber()}</td>
                            <td className="pr-2">{formatCurrency(p.totalCost.toNumber())}</td>
                            <td>{formatCurrency(p.totalCost.toNumber() / p.quantity.toNumber())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(adjustmentsBySupply.get(s.id) ?? []).length > 0 && (
                      <table className="mt-2 text-xs">
                        <thead>
                          <tr className="tk-table-head-row">
                            <th className="pr-2">Data</th>
                            <th className="pr-2">Ajuste</th>
                            <th className="pr-2">Motivo</th>
                            <th>Obs.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(adjustmentsBySupply.get(s.id) ?? []).map((adj) => (
                            <tr key={adj.id} className="tk-row">
                              <td className="pr-2">{formatDate(adj.createdAt)}</td>
                              <td className="pr-2">{adj.difference.toNumber() > 0 ? '+' : ''}{adj.difference.toNumber()}</td>
                              <td className="pr-2">{STOCK_ADJUSTMENT_REASON_LABELS[adj.reason]}</td>
                              <td>{adj.reasonNote ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </details>
                  <div className="flex items-center gap-3">
                    <Link href={`/supplies?editId=${s.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Editar
                    </Link>
                    <AdjustStockButton resourceType="SUPPLY" resourceId={s.id} resourceName={s.name} currentQuantity={currentStock} unitLabel={SUPPLY_UNIT_LABELS[s.unit] === 'Unidade' ? '' : ` ${s.unit.toLowerCase()}`} />
                    <ConfirmDeleteForm action={async () => { 'use server'; await deleteSupply(s.id) }} />
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filteredMainRows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum insumo encontrado com esses filtros.
        </div>
      )}

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
