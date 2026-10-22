'use client'
import { useMemo, useState } from 'react'

const integer = new Intl.NumberFormat('pt-BR')
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export interface ProductionProductRow {
  productId: string
  productName: string
  runsCount: number
  quantitySuccess: number
  totalCost: number
}

type SortKey = 'productName' | 'runsCount' | 'quantitySuccess' | 'totalCost' | 'unitCost'

const PAGE = 10

// Produção por produto: busca, ordenação por coluna e custo por unidade
// (custo total ÷ unidades). Mostra as primeiras linhas, "ver todos" abre o resto.
export function ProductionByProductTable({ rows }: { rows: ProductionProductRow[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'quantitySuccess', dir: 'desc' })
  const [showAll, setShowAll] = useState(false)

  const data = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const withUnit = rows
      .filter((r) => !needle || r.productName.toLowerCase().includes(needle))
      .map((r) => ({ ...r, unitCost: r.quantitySuccess > 0 ? r.totalCost / r.quantitySuccess : null }))
    const factor = sort.dir === 'asc' ? 1 : -1
    return withUnit.sort((a, b) => {
      if (sort.key === 'productName') return factor * a.productName.localeCompare(b.productName)
      const av = a[sort.key] ?? -1
      const bv = b[sort.key] ?? -1
      return factor * (av - bv)
    })
  }, [rows, query, sort])

  const shown = showAll ? data : data.slice(0, PAGE)

  function header(key: SortKey, label: string, align: 'left' | 'right') {
    const active = sort.key === key
    return (
      <th className={`py-3 ${align === 'right' ? 'text-right' : 'pl-5 text-left'} ${align === 'right' ? 'pr-5' : ''}`}>
        <button
          type="button"
          onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'productName' ? 'asc' : 'desc' }))}
          className={`uppercase tracking-wide hover:text-slate-700 dark:hover:text-slate-200 ${active ? 'text-violet-600 dark:text-violet-400' : ''}`}
        >
          {label}
          {active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Produção por produto</h3>
        <span className="text-xs text-slate-400 dark:text-slate-500">{integer.format(data.length)} produtos</span>
      </div>
      <div className="px-4 pb-3">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar produto…" className="tk-input-full w-full sm:w-64" />
      </div>
      {data.length === 0 ? (
        <p className="px-5 pb-6 text-center text-sm text-slate-400 dark:text-slate-500">Nenhuma produção registrada com esses filtros.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 text-xs font-medium text-slate-400 dark:border-slate-800 dark:text-slate-500">
                {header('productName', 'Produto', 'left')}
                {header('runsCount', 'Produções', 'right')}
                {header('quantitySuccess', 'Unidades', 'right')}
                {header('totalCost', 'Custo total', 'right')}
                {header('unitCost', 'Custo/un.', 'right')}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.productId} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                  <td className="py-3 pl-5 font-medium text-slate-800 dark:text-slate-200">{row.productName}</td>
                  <td className="py-3 pr-5 text-right tabular-nums text-slate-600 dark:text-slate-400">{integer.format(row.runsCount)}</td>
                  <td className="py-3 pr-5 text-right tabular-nums text-slate-600 dark:text-slate-400">{integer.format(row.quantitySuccess)}</td>
                  <td className="py-3 pr-5 text-right tabular-nums text-slate-800 dark:text-slate-200">{currency.format(row.totalCost)}</td>
                  <td className="py-3 pr-5 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">{row.unitCost === null ? '—' : currency.format(row.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.length > PAGE && (
        <div className="border-t border-slate-100 p-3 text-center dark:border-slate-800">
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
            {showAll ? 'Mostrar menos' : `Ver todos (${integer.format(data.length)})`}
          </button>
        </div>
      )}
    </div>
  )
}
