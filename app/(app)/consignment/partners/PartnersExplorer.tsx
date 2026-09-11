'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { PartnerForm } from './PartnerForm'

export interface PartnerCardRow {
  id: string
  name: string
  defaultCommissionPercent: number // fração 0-1
  itemsWithPartner: number
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2)
  return words.map((w) => w[0]).join('').toUpperCase()
}

// Melhoria "Parceiros de consignação" §1/§3/§7/§8: cadastro em modal, lista
// vira grade de cards (cada um leva pra página dedicada do parceiro, item
// 3), cards de resumo + busca por nome no topo.
export function PartnersExplorer({ partners, avgCommissionPercent }: { partners: PartnerCardRow[]; avgCommissionPercent: number }) {
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const totalItemsInConsignment = useMemo(() => partners.reduce((sum, p) => sum + p.itemsWithPartner, 0), [partners])

  const visiblePartners = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return partners
    return partners.filter((p) => p.name.toLowerCase().includes(term))
  }, [partners, search])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="tk-page-title mb-0">Parceiros de consignação</h1>
        <button type="button" onClick={() => setModalOpen(true)} className="tk-btn-primary px-4">
          + Novo parceiro
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Parceiros ativos</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{partners.length}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Itens em consignação</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{totalItemsInConsignment}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Comissão média</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{(avgCommissionPercent * 100).toFixed(0)}%</p>
        </div>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar parceiro"
        className="tk-input mt-4 w-full max-w-sm"
      />

      {visiblePartners.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum parceiro encontrado.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visiblePartners.map((p) => (
            <Link key={p.id} href={`/consignment/partners/${p.id}`} className="tk-panel block p-4 transition-colors hover:border-amber-400 dark:hover:border-amber-500">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {initials(p.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900 dark:text-slate-100">{p.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Comissão {(p.defaultCommissionPercent * 100).toFixed(0)}%</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
                {p.itemsWithPartner > 0 ? `${p.itemsWithPartner} ${p.itemsWithPartner === 1 ? 'item com ela' : 'itens com ela'}` : 'Nenhum item em mãos'}
                <span aria-hidden>›</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <PartnerForm open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
