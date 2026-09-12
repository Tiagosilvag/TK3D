'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency, getStockStatusBadge } from '@/lib/format'
import type { StockStatus } from '@/lib/costing'
import { StatusBadge } from '@/components/StatusBadge'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { ActionsMenu } from '@/components/ActionsMenu'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { deleteAccessory } from '@/actions/accessories'
import { AccessoryForm, type EditingAccessory } from './AccessoryForm'
import { RestockForm } from './RestockForm'
import { AccessoryHistoryButton, type PurchaseEntry, type AdjustmentEntry, type ConsumptionEntry } from './AccessoryHistoryButton'
import type { AccessoryTypeOption } from './TypeManagerPanel'

export interface AccessoryRow {
  id: string
  name: string
  colorName: string
  colorHex: string | null
  typeId: string
  typeName: string
  currentStock: number
  avgUnitCost: number
  valueInStock: number
  percentRemaining: number
  status: StockStatus
  purchases: PurchaseEntry[]
  adjustments: AdjustmentEntry[]
  consumptionHistory: ConsumptionEntry[]
}

function barColorClass(statusLabel: string): string {
  if (statusLabel === 'Estoque crítico') return 'bg-red-500'
  if (statusLabel === 'Estoque baixo') return 'bg-amber-500'
  return 'bg-emerald-500'
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white dark:from-violet-500 dark:to-fuchsia-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

export interface AccessoriesSummary {
  totalValueInStock: number
  countByStatus: Record<string, number>
}

// Melhoria "Acessórios": busca + dropdown de tipo + modal, mesmo padrão de
// FilamentsExplorer/SuppliesExplorer/PackagingExplorer. Tabela combina
// Nome+Cor (bolinha + subtexto) e Estoque+% Restante (barra) numa coluna
// só, e move Repor estoque/Histórico do corpo da tabela pro menu de ações
// (⋯) -- reduz de 10 colunas pra 7 (spec §4).
export function AccessoriesExplorer({
  rows,
  accessoryTypes,
  editingAccessory,
  summary,
}: {
  rows: AccessoryRow[]
  accessoryTypes: AccessoryTypeOption[]
  editingAccessory?: EditingAccessory
  summary: AccessoriesSummary
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTarget, setModalTarget] = useState<EditingAccessory | undefined>(undefined)

  useEffect(() => {
    if (editingAccessory) {
      setModalTarget(editingAccessory)
      setModalOpen(true)
    }
  }, [editingAccessory])

  function closeModal() {
    setModalOpen(false)
    if (editingAccessory) router.push('/accessories')
  }

  function openNew() {
    setModalTarget(undefined)
    setModalOpen(true)
  }

  const lowStockCount = useMemo(() => rows.filter((r) => r.status.label === 'Estoque baixo').length, [rows])

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (typeFilter && r.typeId !== typeFilter) return false
      if (lowOnly && r.status.label !== 'Estoque baixo') return false
      if (term) {
        const haystack = `${r.name} ${r.typeName} ${r.colorName}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [rows, search, typeFilter, lowOnly])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="tk-page-title mb-0">Acessórios</h1>
        <button type="button" onClick={openNew} className="tk-btn-primary px-4">
          + Novo acessório
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Valor total em estoque</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(summary.totalValueInStock)}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🟢 Em estoque</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{summary.countByStatus['Em estoque'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🟡 Estoque baixo</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{summary.countByStatus['Estoque baixo'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🔴 Estoque crítico</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{summary.countByStatus['Estoque crítico'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">⚫ Esgotados</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{summary.countByStatus['Esgotado'] ?? 0}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar nome, tipo ou cor"
          className="tk-input min-w-[240px] flex-1"
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="tk-input">
          <option value="">Todos os tipos</option>
          {accessoryTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="mb-4 mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setLowOnly(false)} className={chipClass(!lowOnly)}>
          Todos
        </button>
        <button type="button" onClick={() => setLowOnly(true)} className={chipClass(lowOnly)}>
          ⚠️ Estoque baixo · {lowStockCount}
        </button>
      </div>

      <table className="tk-table-zebra w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-3">Nome</th>
            <th>Tipo</th>
            <th>Estoque</th>
            <th>Custo médio</th>
            <th>Valor em estoque</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={r.id} className="tk-row align-top">
              <td className="py-3">
                <div className="flex items-center gap-2">
                  {r.colorHex && <span style={{ background: r.colorHex }} className="inline-block h-3 w-3 shrink-0 rounded-full" />}
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{r.name}</p>
                    {r.colorName && <p className="text-xs text-slate-500 dark:text-slate-400">{r.colorName}</p>}
                  </div>
                </div>
              </td>
              <td className="text-slate-500 dark:text-slate-400">{r.typeName}</td>
              <td>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${barColorClass(r.status.label)}`}
                      style={{ width: `${Math.min(100, Math.max(0, r.percentRemaining))}%` }}
                    />
                  </div>
                  <span className="whitespace-nowrap tabular-nums text-slate-900 dark:text-slate-100">
                    {r.currentStock} un / {r.percentRemaining.toFixed(0)}%
                  </span>
                </div>
              </td>
              <td className="text-slate-500 dark:text-slate-400">{formatCurrency(r.avgUnitCost)}</td>
              <td className="text-slate-500 dark:text-slate-400">{formatCurrency(r.valueInStock)}</td>
              <td><StatusBadge badge={getStockStatusBadge(r.status)} /></td>
              <td>
                <ActionsMenu>
                  <Link href={`/accessories?editId=${r.id}`} className="tk-menu-item">
                    Editar
                  </Link>
                  <RestockForm accessoryId={r.id} accessoryName={r.name} className="tk-menu-item" />
                  <AccessoryHistoryButton
                    accessoryName={r.name}
                    purchases={r.purchases}
                    adjustments={r.adjustments}
                    consumptionHistory={r.consumptionHistory}
                  />
                  <AdjustStockButton resourceType="ACCESSORY" resourceId={r.id} resourceName={r.name} currentQuantity={r.currentStock} />
                  <ConfirmDeleteForm action={async () => { return await deleteAccessory(r.id) }} className="tk-menu-item-danger" />
                </ActionsMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {visibleRows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum acessório encontrado com esses filtros.
        </div>
      )}

      <AccessoryForm
        key={modalTarget?.id ?? 'new'}
        open={modalOpen}
        onOpenChange={(open) => (open ? setModalOpen(true) : closeModal())}
        accessoryTypes={accessoryTypes}
        editingAccessory={modalTarget}
      />
    </div>
  )
}
