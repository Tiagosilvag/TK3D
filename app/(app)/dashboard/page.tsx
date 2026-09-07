import { Fragment } from 'react'
import {
  getRevenueByChannel,
  getTotalWasteCost,
  getTopProducts,
  getConsignmentStockSummary,
  getConsignmentRevenue,
} from '@/lib/reports'

// This page aggregates data mutated by actions on several other routes
// (production runs, consignment deliveries/sale reports, and eventually
// direct sales) that only revalidate their own paths, not /dashboard.
// Force dynamic rendering so it always reflects the latest data instead of
// a stale build-time snapshot.
export const dynamic = 'force-dynamic'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const integer = new Intl.NumberFormat('pt-BR')

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
      {children}
    </div>
  )
}

export default async function DashboardPage() {
  const [revenue, wasteCost, topProducts, consignmentStock, consignmentRevenue] = await Promise.all([
    getRevenueByChannel(),
    getTotalWasteCost(),
    getTopProducts(5),
    getConsignmentStockSummary(),
    getConsignmentRevenue(),
  ])

  const totalRevenue = revenue.DIRETA + revenue.MARKETPLACE + consignmentRevenue
  const diretaShare = totalRevenue > 0 ? (revenue.DIRETA / totalRevenue) * 100 : 0
  const marketplaceShare = totalRevenue > 0 ? (revenue.MARKETPLACE / totalRevenue) * 100 : 0
  const consignmentShare = totalRevenue > 0 ? 100 - diretaShare - marketplaceShare : 0
  const consignmentUnits = consignmentStock.reduce((sum, s) => sum + s.remaining, 0)

  const consignmentByPartner = [...consignmentStock]
    .sort((a, b) => a.partnerName.localeCompare(b.partnerName) || b.remaining - a.remaining)
    .reduce<Record<string, typeof consignmentStock>>((acc, item) => {
      ;(acc[item.partnerName] ??= []).push(item)
      return acc
    }, {})

  return (
    <div className="mx-auto max-w-5xl space-y-10 p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Visão geral</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
      </header>

      {/* Hero: revenue is the headline number of the business — everything else is secondary. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Receita total</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-slate-900 sm:text-5xl">
              {currency.format(totalRevenue)}
            </p>
          </div>
          <dl className="flex gap-8">
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Direta
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{currency.format(revenue.DIRETA)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span className="h-2 w-2 rounded-full bg-slate-300" /> Marketplace
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{currency.format(revenue.MARKETPLACE)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Consignação
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{currency.format(consignmentRevenue)}</dd>
            </div>
          </dl>
        </div>
        <div className="mt-6 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          {totalRevenue > 0 ? (
            <>
              <div className="h-full bg-emerald-500" style={{ width: `${diretaShare}%` }} />
              <div className="h-full bg-slate-300" style={{ width: `${marketplaceShare}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${consignmentShare}%` }} />
            </>
          ) : null}
        </div>
      </section>

      {/* Secondary metrics: waste is money lost (amber), consignment units are assets held by partners (slate). */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-medium text-slate-500">Custo total de desperdício</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-amber-600">
            {currency.format(wasteCost)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Material e tempo de máquina perdidos em falhas de impressão</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-medium text-slate-500">Peças em consignação</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
            {integer.format(consignmentUnits)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Unidades entregues a parceiros, ainda não vendidas</p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Top 5 produtos mais vendidos</h2>
        {topProducts.length === 0 ? (
          <EmptyState>Nenhuma venda registrada ainda.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="w-12 py-3 pl-5"></th>
                  <th className="py-3">Produto</th>
                  <th className="py-3 pr-5 text-right">Unidades vendidas</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((entry, i) => (
                  <tr key={entry.product.id} className={i !== topProducts.length - 1 ? 'border-b border-slate-100' : ''}>
                    <td className="py-3 pl-5">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          i === 0 ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-3 font-medium text-slate-800">{entry.product.name}</td>
                    <td className="py-3 pr-5 text-right tabular-nums text-slate-600">{integer.format(entry.quantitySold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Estoque em consignação por parceiro</h2>
        {consignmentStock.length === 0 ? (
          <EmptyState>Nenhum estoque em consignação no momento.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="py-3 pl-5">Parceiro / Produto</th>
                  <th className="py-3 pr-5 text-right">Saldo restante</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(consignmentByPartner).map(([partnerName, items]) => (
                  <Fragment key={partnerName}>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={2} className="py-2 pl-5 text-xs font-semibold text-slate-500">
                        {partnerName}
                      </td>
                    </tr>
                    {items.map((item, i) => (
                      <tr
                        key={`${partnerName}-${item.productName}-${i}`}
                        className={i !== items.length - 1 ? 'border-b border-slate-100' : ''}
                      >
                        <td className="py-3 pl-9 text-slate-700">{item.productName}</td>
                        <td className="py-3 pr-5 text-right tabular-nums font-medium text-slate-800">
                          {integer.format(item.remaining)}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
