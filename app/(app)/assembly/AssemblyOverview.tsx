'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { AssemblyOverviewRow } from '@/actions/assembly'

// Melhoria "Montagem" §2: lista geral no topo -- busca por nome + Já
// montado/Disponível (vermelho quando zerado, verde quando há) -- clicar
// numa linha navega pro detalhe (?productId=), que abre como modal (ver
// AssemblyDetailModal.tsx).
//
// Melhoria "Montagem, o que falta": cards de resumo (mesmo padrão dos de
// /stock) + chips de filtro rápido -- "Travadas" usa a MESMA condição já
// usada pra colorir a coluna Disponível (maxAssemblableUnits <= 0), nunca
// uma segunda fórmula que pudesse divergir.
type Chip = 'ALL' | 'BLOCKED' | 'READY' | 'ASSEMBLED'

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

export function AssemblyOverview({ rows }: { rows: AssemblyOverviewRow[] }) {
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState<Chip>('ALL')

  const totalProducts = rows.length
  const blockedCount = rows.filter((r) => r.maxAssemblableUnits <= 0).length
  const totalReadyToAssemble = rows.reduce((sum, r) => sum + r.maxAssemblableUnits, 0)
  const totalAlreadyAssembled = rows.reduce((sum, r) => sum + r.alreadyAssembled, 0)

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (term && !r.productName.toLowerCase().includes(term)) return false
      if (chip === 'BLOCKED' && r.maxAssemblableUnits > 0) return false
      if (chip === 'READY' && r.maxAssemblableUnits <= 0) return false
      if (chip === 'ASSEMBLED' && r.alreadyAssembled <= 0) return false
      return true
    })
  }, [rows, search, chip])

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total de produtos</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalProducts}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Travados</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${blockedCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>{blockedCount}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Prontas p/ montar</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalReadyToAssemble} unidades</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Já montado</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalAlreadyAssembled} unidades</p>
        </div>
      </div>

      <div className="mt-4 tk-panel p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar produto"
          className="tk-input-full"
        />

        <div className="mb-1 mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setChip('ALL')} className={chipClass(chip === 'ALL')}>Todos</button>
          <button type="button" onClick={() => setChip('BLOCKED')} className={chipClass(chip === 'BLOCKED')}>Travadas</button>
          <button type="button" onClick={() => setChip('READY')} className={chipClass(chip === 'READY')}>Prontas p/ montar</button>
          <button type="button" onClick={() => setChip('ASSEMBLED')} className={chipClass(chip === 'ASSEMBLED')}>Já montado</button>
        </div>

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
    </div>
  )
}
