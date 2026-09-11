'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { ActionsMenu } from '@/components/ActionsMenu'
import { StockAdjustmentHistoryButton, type AdjustmentEntry } from './StockAdjustmentHistoryButton'

export interface StockRow {
  productId: string
  productName: string
  category: string
  isComposite: boolean
  needsAssembly: boolean
  coverPhotoId: string | null
  available: number
  // null = produto não passa por Montagem (item único sem componente) --
  // mostra "-" em vez de 0, que significaria "passa por montagem mas não
  // tem nada pronto".
  readyToAssemble: number | null
  consignado: number
  soldDirect: number
  produced: number
  variantBreakdown: { label: string; quantity: number }[]
  lowStock: boolean
  adjustments: AdjustmentEntry[]
}

type Chip = 'ALL' | 'MOST_STOCK' | 'LOW_STOCK' | 'READY_TO_ASSEMBLE'

const PAGE_SIZE = 10

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

export function StockExplorer({ rows }: { rows: StockRow[] }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [chip, setChip] = useState<Chip>('ALL')
  const [page, setPage] = useState(1)

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort(), [rows])

  const totalAvailable = rows.reduce((sum, r) => sum + r.available, 0)
  const totalReadyToAssemble = rows.reduce((sum, r) => sum + (r.readyToAssemble ?? 0), 0)
  const lowStockCount = rows.filter((r) => r.lowStock).length

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    let list = rows.filter((r) => {
      if (category && r.category !== category) return false
      if (term && !r.productName.toLowerCase().includes(term)) return false
      if (chip === 'LOW_STOCK' && !r.lowStock) return false
      if (chip === 'READY_TO_ASSEMBLE' && !(r.readyToAssemble && r.readyToAssemble > 0)) return false
      return true
    })
    if (chip === 'MOST_STOCK') list = [...list].sort((a, b) => b.available - a.available)
    return list
  }, [rows, search, category, chip])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function changeFilter(fn: () => void) {
    fn()
    setPage(1)
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total disponível</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalAvailable} unidades</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Prontas p/ montar</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalReadyToAssemble} unidades</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">⚠️ Pouco estoque</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{lowStockCount} produtos</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => changeFilter(() => setSearch(e.target.value))}
          placeholder="Buscar produto"
          className="tk-input min-w-[240px] flex-1"
        />
        <select value={category} onChange={(e) => changeFilter(() => setCategory(e.target.value))} className="tk-input">
          <option value="">Todas categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="mb-4 mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => changeFilter(() => setChip('ALL'))} className={chipClass(chip === 'ALL')}>Todos</button>
        <button type="button" onClick={() => changeFilter(() => setChip('MOST_STOCK'))} className={chipClass(chip === 'MOST_STOCK')}>Maior estoque</button>
        <button type="button" onClick={() => changeFilter(() => setChip('LOW_STOCK'))} className={chipClass(chip === 'LOW_STOCK')}>Pouco estoque</button>
        <button type="button" onClick={() => changeFilter(() => setChip('READY_TO_ASSEMBLE'))} className={chipClass(chip === 'READY_TO_ASSEMBLE')}>Pronto p/ montar</button>
      </div>

      {pageRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto encontrado com esses filtros.
        </div>
      ) : (
        <table className="tk-table-zebra w-full text-sm">
          <thead>
            <tr className="tk-table-head-row">
              <th className="py-3">Produto</th>
              <th>Disp.</th>
              <th>Prontas p/ montar</th>
              <th>Consignado</th>
              <th>Vendido</th>
              <th className="text-slate-400 dark:text-slate-500">Produzido</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.productId} className="tk-row align-top">
                <td className="py-3">
                  <div className="flex items-start gap-2">
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                      {r.coverPhotoId ? (
                        // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, not a static/optimizable asset
                        <img src={`/api/photos/${r.coverPhotoId}`} alt={r.productName} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div>
                      <Link href={`/products/${r.productId}`} className="font-medium text-amber-700 hover:underline dark:text-amber-400">
                        {r.productName}
                      </Link>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {r.category}
                        {r.isComposite && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">composto</span>}
                      </p>
                    </div>
                  </div>
                </td>
                <td className={`font-medium ${r.available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {r.available}
                </td>
                <td>
                  {r.readyToAssemble == null ? (
                    '-'
                  ) : r.readyToAssemble > 0 ? (
                    <Link href={`/assembly?productId=${r.productId}`} className="font-medium text-amber-600 hover:underline dark:text-amber-400">
                      {r.readyToAssemble} montar &rarr;
                    </Link>
                  ) : (
                    r.readyToAssemble
                  )}
                </td>
                <td>{r.consignado}</td>
                <td>{r.soldDirect}</td>
                <td className="text-slate-400 dark:text-slate-500">
                  {r.produced}
                  {r.variantBreakdown.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs">Por variante</summary>
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {r.variantBreakdown.map((v) => (
                          <li key={v.label}>{v.label}: {v.quantity}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td>
                  <ActionsMenu>
                    <Link href={`/sales?productId=${r.productId}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Registrar venda direta
                    </Link>
                    <Link href={`/consignment/deliveries?productId=${r.productId}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Entregar a parceiro
                    </Link>
                    <hr className="w-full border-slate-200 dark:border-slate-700" />
                    <AdjustStockButton resourceType="PRODUCT" resourceId={r.productId} resourceName={r.productName} currentQuantity={r.available} />
                    <StockAdjustmentHistoryButton productName={r.productName} adjustments={r.adjustments} />
                  </ActionsMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {filteredRows.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Mostrando {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredRows.length)} de {filteredRows.length}</span>
          <div className="flex gap-2">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg px-3 py-1.5 font-medium text-amber-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline dark:text-amber-400 dark:disabled:text-slate-600">
              ←
            </button>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="rounded-lg px-3 py-1.5 font-medium text-amber-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline dark:text-amber-400 dark:disabled:text-slate-600">
              →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
