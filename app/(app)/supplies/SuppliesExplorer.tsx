'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatUnitCost, getStockStatusBadge, STOCK_ADJUSTMENT_REASON_LABELS, SUPPLY_UNIT_SUFFIX } from '@/lib/format'
import type { StockStatus } from '@/lib/costing'
import { StatusBadge } from '@/components/StatusBadge'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { ActionsMenu } from '@/components/ActionsMenu'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { deleteSupply } from '@/actions/supplies'
import { SupplyForm, type EditingSupply } from './SupplyForm'
import { RestockForm } from './RestockForm'
import type { SupplyUnit } from '@prisma/client'

const CONSUMPTION_SOURCE_LABELS = { ASSEMBLY: 'Montagem', SALE: 'Venda' } as const

const SUPPLY_UNIT_LABELS: Record<SupplyUnit, string> = {
  UN: 'Unidade',
  ML: 'Mililitro',
  G: 'Grama',
  M: 'Metro',
  OUTRO: 'Outro',
}

export interface SupplyPurchaseEntry {
  id: string
  purchaseDate: string
  quantity: number
  totalCost: number
}

export interface SupplyAdjustmentEntry {
  id: string
  createdAt: string
  difference: number
  reason: string
  reasonNote: string | null
}

export interface SupplyConsumptionEntry {
  id: string
  consumedAt: string
  quantity: number
  productName: string
  source: 'ASSEMBLY' | 'SALE'
}

export interface SupplyRow {
  id: string
  name: string
  unit: SupplyUnit
  currentStock: number
  avgUnitCost: number
  valueInStock: number
  percentRemaining: number
  defaultUsage: number | null
  status: StockStatus
  purchases: SupplyPurchaseEntry[]
  adjustments: SupplyAdjustmentEntry[]
  consumptionHistory: SupplyConsumptionEntry[]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white dark:from-violet-500 dark:to-fuchsia-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

// Melhoria "Insumos": busca em tempo real + dropdown de unidade + modal,
// mesmo padrão de FilamentsExplorer/PackagingExplorer -- dataset inteiro
// já vem do servidor (poucas dezenas de itens), filtrar no navegador é
// instantâneo sem lib nova. Cards de resumo e seção de esgotados
// continuam em page.tsx (Server Component), só a parte interativa
// (busca/filtro/tabela/modal) vira client aqui.
export interface SuppliesSummary {
  totalValueInStock: number
  countByStatus: Record<string, number>
}

export function SuppliesExplorer({
  rows,
  editingSupply,
  summary,
}: {
  rows: SupplyRow[]
  editingSupply?: EditingSupply
  summary: SuppliesSummary
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [unit, setUnit] = useState<SupplyUnit | ''>('')
  const [lowOnly, setLowOnly] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTarget, setModalTarget] = useState<EditingSupply | undefined>(undefined)

  useEffect(() => {
    if (editingSupply) {
      setModalTarget(editingSupply)
      setModalOpen(true)
    }
  }, [editingSupply])

  function closeModal() {
    setModalOpen(false)
    if (editingSupply) router.push('/supplies')
  }

  function openNew() {
    setModalTarget(undefined)
    setModalOpen(true)
  }

  const lowStockCount = useMemo(() => rows.filter((r) => r.status.label === 'Estoque baixo').length, [rows])

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (unit && r.unit !== unit) return false
      if (lowOnly && r.status.label !== 'Estoque baixo') return false
      if (term && !r.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [rows, search, unit, lowOnly])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="tk-page-title mb-0">Insumos</h1>
        <button type="button" onClick={openNew} className="tk-btn-primary px-4">
          + Novo insumo
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
          placeholder="Buscar insumo"
          className="tk-input min-w-[240px] flex-1"
        />
        <select value={unit} onChange={(e) => setUnit(e.target.value as SupplyUnit | '')} className="tk-input">
          <option value="">Todas unidades</option>
          {(Object.entries(SUPPLY_UNIT_LABELS) as [SupplyUnit, string][]).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
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
            <th>Estoque</th>
            <th>Custo/unidade</th>
            <th>Valor em estoque</th>
            <th>Uso padrão</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => (
            <tr key={r.id} className="tk-row align-top">
              <td className="py-3 font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
              <td>{r.currentStock} {SUPPLY_UNIT_SUFFIX[r.unit]}</td>
              <td className="text-slate-500 dark:text-slate-400">{formatUnitCost(r.unit, r.avgUnitCost)}</td>
              <td className="text-slate-500 dark:text-slate-400">{formatCurrency(r.valueInStock)}</td>
              <td className="text-slate-500 dark:text-slate-400">
                {r.defaultUsage != null ? `${r.defaultUsage} ${SUPPLY_UNIT_SUFFIX[r.unit]}` : '—'}
              </td>
              <td><StatusBadge badge={getStockStatusBadge(r.status)} /></td>
              <td>
                <div className="flex flex-col items-start gap-1">
                  {(r.purchases.length > 0 || r.adjustments.length > 0 || r.consumptionHistory.length > 0) && (
                    <details>
                      <summary className="tk-summary">Histórico ({r.purchases.length + r.adjustments.length + r.consumptionHistory.length})</summary>
                      {r.purchases.length > 0 && (
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
                            {r.purchases.map((p) => (
                              <tr key={p.id} className="tk-row">
                                <td className="pr-2">{formatDate(p.purchaseDate)}</td>
                                <td className="pr-2">{p.quantity}</td>
                                <td className="pr-2">{formatCurrency(p.totalCost)}</td>
                                <td>{formatCurrency(p.totalCost / p.quantity)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {r.adjustments.length > 0 && (
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
                            {r.adjustments.map((adj) => (
                              <tr key={adj.id} className="tk-row">
                                <td className="pr-2">{formatDate(adj.createdAt)}</td>
                                <td className="pr-2">{adj.difference > 0 ? '+' : ''}{adj.difference}</td>
                                <td className="pr-2">{STOCK_ADJUSTMENT_REASON_LABELS[adj.reason as keyof typeof STOCK_ADJUSTMENT_REASON_LABELS]}</td>
                                <td>{adj.reasonNote ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {r.consumptionHistory.length > 0 && (
                        <table className="mt-2 text-xs">
                          <thead>
                            <tr className="tk-table-head-row">
                              <th className="pr-2">Data</th>
                              <th className="pr-2">Consumido</th>
                              <th className="pr-2">Produto</th>
                              <th>Origem</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.consumptionHistory.map((c) => (
                              <tr key={c.id} className="tk-row">
                                <td className="pr-2">{formatDate(c.consumedAt)}</td>
                                <td className="pr-2">-{c.quantity}</td>
                                <td className="pr-2">{c.productName}</td>
                                <td>{CONSUMPTION_SOURCE_LABELS[c.source]}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </details>
                  )}
                  <RestockForm supplyId={r.id} supplyName={r.name} />
                  <ActionsMenu>
                    <Link href={`/supplies?editId=${r.id}`} className="text-violet-600 hover:underline dark:text-violet-400">
                      Editar
                    </Link>
                    <AdjustStockButton
                      resourceType="SUPPLY"
                      resourceId={r.id}
                      resourceName={r.name}
                      currentQuantity={r.currentStock}
                      unitLabel={r.unit === 'UN' ? '' : ` ${SUPPLY_UNIT_SUFFIX[r.unit]}`}
                    />
                    <ConfirmDeleteForm action={async () => { return await deleteSupply(r.id) }} />
                  </ActionsMenu>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {visibleRows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum insumo encontrado com esses filtros.
        </div>
      )}

      <SupplyForm
        key={modalTarget?.id ?? 'new'}
        open={modalOpen}
        onOpenChange={(open) => (open ? setModalOpen(true) : closeModal())}
        editingSupply={modalTarget}
      />
    </div>
  )
}
