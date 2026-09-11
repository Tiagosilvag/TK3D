'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { AssemblyOverviewRow } from '@/actions/assembly'

// Melhoria "Montagem" §2: lista geral no topo -- busca por nome + Já
// montado/Disponível (vermelho quando zerado, verde quando há) -- clicar
// numa linha navega pro detalhe (?productId=), substituindo o dropdown
// único que existia antes.
export function AssemblyOverview({ rows }: { rows: AssemblyOverviewRow[] }) {
  const [search, setSearch] = useState('')

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((r) => r.productName.toLowerCase().includes(term))
  }, [rows, search])

  return (
    <div className="tk-panel p-4">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar produto"
        className="tk-input-full"
      />

      {visibleRows.length === 0 ? (
        <p className="mt-4 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum produto encontrado.</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="tk-table-head-row">
              <th className="py-2">Produto</th>
              <th>Já montado</th>
              <th>Disp. p/ montagem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.productId} className="tk-row">
                <td className="py-2">
                  <Link href={`/assembly?productId=${r.productId}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
                    {r.productName}
                  </Link>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{r.partsCount} peça{r.partsCount === 1 ? '' : 's'}</span>
                </td>
                <td>{r.alreadyAssembled}</td>
                <td>
                  <Link
                    href={`/assembly?productId=${r.productId}`}
                    className={`font-medium hover:underline ${r.maxAssemblableUnits > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                  >
                    {r.maxAssemblableUnits} unidade{r.maxAssemblableUnits === 1 ? '' : 's'}
                  </Link>
                </td>
                <td className="text-right text-slate-400" aria-hidden>
                  <Link href={`/assembly?productId=${r.productId}`}>›</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
