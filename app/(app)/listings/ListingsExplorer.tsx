'use client'
import { useMemo, useState } from 'react'
import { formatCurrency, getMarketplacePlatformBadge, LISTING_STATUS_LABELS } from '@/lib/format'
import { ListingRow } from './ListingRow'
import { NewListingDialog } from './NewListingDialog'
import type { ListingsPageData } from '@/actions/listings'
import type { ListingStatus } from '@prisma/client'

type Tab = 'ANUNCIOS' | 'SEM_ANUNCIO'
type PlatformFilter = 'TODAS' | string
type StatusFilter = 'TODOS' | ListingStatus

function chipClass(active: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
  }`
}

// Anúncios: cards de métrica + toolbar (Plataforma dinâmica/Status/Busca,
// filtragem client-side sobre os dados já carregados -- mesmo padrão de
// outras Explorer screens) + 2 abas, mesmo layout do protótipo de
// referência. Métricas sempre sobre o conjunto COMPLETO (data.metrics,
// calculado no servidor), nunca recalculadas sobre o filtro da toolbar.
export function ListingsExplorer({ data }: { data: ListingsPageData }) {
  const [tab, setTab] = useState<Tab>('ANUNCIOS')
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('TODAS')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS')
  const [search, setSearch] = useState('')

  const visibleListings = useMemo(() => {
    const term = search.trim().toLowerCase()
    return data.listings.filter((l) => {
      if (platformFilter !== 'TODAS' && l.platformId !== platformFilter) return false
      if (statusFilter !== 'TODOS' && l.status !== statusFilter) return false
      if (term && !l.productName.toLowerCase().includes(term)) return false
      return true
    })
  }, [data.listings, platformFilter, statusFilter, search])

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Anúncios ativos</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{data.metrics.activeCount}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Produtos sem anúncio</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{data.metrics.productsWithoutListingCount}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Lucro médio por anúncio</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(data.metrics.avgProfit)}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Margem abaixo de 20%</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${data.metrics.lowMarginCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {data.metrics.lowMarginCount}
          </p>
        </div>
      </div>

      <div className="tk-panel mt-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          Plataforma
          <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} className="tk-input-full">
            <option value="TODAS">Todas</option>
            {data.platforms.map((p) => <option key={p.id} value={p.id}>{getMarketplacePlatformBadge(p.kind).label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="tk-input-full">
            <option value="TODOS">Todos</option>
            {(Object.keys(LISTING_STATUS_LABELS) as ListingStatus[]).map((s) => <option key={s} value={s}>{LISTING_STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Buscar produto
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex.: Mini Jesus" className="tk-input-full" />
        </label>
        <div className="flex-1" />
        <NewListingDialog
          products={data.allProducts}
          platforms={data.platforms}
          trigger={<button type="button" className="tk-btn-primary">+ Novo anúncio</button>}
        />
      </div>

      <div className="mb-3 mt-4 flex w-fit gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
        <button type="button" onClick={() => setTab('ANUNCIOS')} className={chipClass(tab === 'ANUNCIOS')}>Anúncios publicados</button>
        <button type="button" onClick={() => setTab('SEM_ANUNCIO')} className={chipClass(tab === 'SEM_ANUNCIO')}>Produtos sem anúncio</button>
      </div>

      {tab === 'ANUNCIOS' ? (
        <>
          <table className="tk-table-zebra w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Produto</th>
                <th>Plataforma</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Custo produção</th>
                <th>Preço no anúncio</th>
                <th>Taxa aplicada</th>
                <th>Brinde / Frete</th>
                <th>Lucro</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleListings.map((row) => (
                <ListingRow key={row.id} row={row} canHaveType={row.platformKind === 'MERCADO_LIVRE'} />
              ))}
            </tbody>
          </table>
          {visibleListings.length === 0 && (
            <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
              Nenhum anúncio encontrado com esses filtros.
            </div>
          )}
        </>
      ) : (
        <>
          <table className="tk-table-zebra w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Produto</th>
                <th>Categoria</th>
                <th>Custo de produção</th>
                <th>Sugerido (referência)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.productsWithoutListing.map((p) => (
                <tr key={p.productId} className="tk-row">
                  <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{p.productName}</td>
                  <td className="text-slate-500 dark:text-slate-400">{p.productCategory}</td>
                  <td className="text-slate-500 dark:text-slate-400">{formatCurrency(p.productionCost)}</td>
                  <td className="text-xs text-slate-400 dark:text-slate-500">
                    {p.suggestedShopee !== null && <>Shopee {formatCurrency(p.suggestedShopee)}</>}
                    {p.suggestedMlClassico !== null && <> · ML Clássico {formatCurrency(p.suggestedMlClassico)}</>}
                    {p.suggestedMlPremium !== null && <> · ML Premium {formatCurrency(p.suggestedMlPremium)}</>}
                  </td>
                  <td>
                    <NewListingDialog
                      products={data.allProducts}
                      platforms={data.platforms}
                      presetProductId={p.productId}
                      trigger={<button type="button" className="tk-btn-primary text-xs">+ Criar anúncio</button>}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.productsWithoutListing.length === 0 && (
            <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
              Todos os produtos já têm ao menos um anúncio.
            </div>
          )}
        </>
      )}
    </div>
  )
}
