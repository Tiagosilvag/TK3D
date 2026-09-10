'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getPackagingStockStatus } from '@/lib/costing'
import { getStockStatusBadge } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { ActionsMenu } from '@/components/ActionsMenu'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { deletePackagingItem } from '@/actions/packaging'
import { PackagingForm, type EditingPackagingItem } from './PackagingForm'
import { RestockForm } from './RestockForm'
import { formatCurrency } from '@/lib/format'

export interface PackagingRow {
  id: string
  name: string
  currentStock: number
  avgUnitCost: number
  minStock: number
  percentRemaining: number
}

function barColorClass(percent: number): string {
  if (percent > 50) return 'bg-emerald-500'
  if (percent >= 20) return 'bg-amber-500'
  return 'bg-red-500'
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

// Melhorias "Embalagens": busca em tempo real + modal, mesmo padrão de
// FilamentsExplorer.tsx -- dataset inteiro já vem do servidor (poucas
// dezenas de itens), filtrar no navegador é instantâneo sem lib nova.
export function PackagingExplorer({ rows, editingItem }: { rows: PackagingRow[]; editingItem?: EditingPackagingItem }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTarget, setModalTarget] = useState<EditingPackagingItem | undefined>(undefined)

  useEffect(() => {
    if (editingItem) {
      setModalTarget(editingItem)
      setModalOpen(true)
    }
  }, [editingItem])

  function closeModal() {
    setModalOpen(false)
    if (editingItem) router.push('/packaging')
  }

  function openNew() {
    setModalTarget(undefined)
    setModalOpen(true)
  }

  const lowStockCount = useMemo(
    () => rows.filter((r) => getPackagingStockStatus(r.currentStock, r.minStock).label === 'Estoque baixo').length,
    [rows],
  )

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (lowOnly && getPackagingStockStatus(r.currentStock, r.minStock).label !== 'Estoque baixo') return false
      if (term && !r.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [rows, search, lowOnly])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="tk-page-title mb-0">Embalagens</h1>
        <button type="button" onClick={openNew} className="tk-btn-primary px-4">
          + Nova embalagem
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar embalagem"
          className="tk-input min-w-[240px] flex-1"
        />
      </div>

      <div className="mb-4 mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setLowOnly(false)} className={chipClass(!lowOnly)}>
          Todas
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
            <th>Custo unitário</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => {
            const status = getPackagingStockStatus(r.currentStock, r.minStock)
            return (
              <tr key={r.id} className="tk-row">
                <td className="py-3 font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${barColorClass(r.percentRemaining)}`}
                        style={{ width: `${Math.min(100, Math.max(0, r.percentRemaining))}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-slate-900 dark:text-slate-100">{r.currentStock} un</span>
                  </div>
                </td>
                <td className="text-slate-500 dark:text-slate-400">{formatCurrency(r.avgUnitCost)}</td>
                <td><StatusBadge badge={getStockStatusBadge(status)} /></td>
                <td>
                  <ActionsMenu>
                    <Link href={`/packaging?editId=${r.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Editar
                    </Link>
                    <RestockForm packagingItemId={r.id} packagingItemName={r.name} />
                    <AdjustStockButton resourceType="PACKAGING" resourceId={r.id} resourceName={r.name} currentQuantity={r.currentStock} unitLabel=" un" />
                    <ConfirmDeleteForm action={async () => { return await deletePackagingItem(r.id) }} />
                  </ActionsMenu>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {visibleRows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma embalagem encontrada com esses filtros.
        </div>
      )}

      <PackagingForm
        key={modalTarget?.id ?? 'new'}
        open={modalOpen}
        onOpenChange={(open) => (open ? setModalOpen(true) : closeModal())}
        editingItem={modalTarget}
      />
    </div>
  )
}
