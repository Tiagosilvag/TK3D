import { Fragment } from 'react'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import {
  getRevenueByChannel,
  getTopProducts,
  getConsignmentStockSummary,
  getConsignmentRevenue,
  getProductionSummary,
  getProductionByProduct,
  getFailuresByWasteReason,
  getPrinterUsage,
  type ProductionReportFilters,
} from '@/lib/reports'
// Melhoria "Produção" (reformulação Plate) §6: "Plates realizadas" e
// "produtos completos vs. parciais" -- reaproveita getProductionByProduct
// de actions/productionRuns.ts (que já traz completeSets via
// getAssemblyStatus) em vez de reimplementar "conjuntos completos" aqui;
// aliado pra não colidir com o getProductionByProduct de lib/reports acima
// (função diferente, shape diferente, mesmo nome por coincidência).
import { getProductionByProduct as getPlateProductionByProduct } from '@/actions/productionRuns'
import { calculateStockReferenceQuantity, calculateStockPercentRemaining, getStockStatusWithThresholds } from '@/lib/costing'
import { formatCurrency, getProductionStatusBadge, WASTE_REASON_LABELS } from '@/lib/format'
import type { ProductionStatus, WasteReason } from '@prisma/client'

// This page aggregates data mutated by actions on several other routes
// (production runs, consignment deliveries/sale reports, and direct sales)
// that only revalidate their own paths, not /dashboard. Force dynamic
// rendering so it always reflects the latest data instead of a stale
// build-time snapshot.
export const dynamic = 'force-dynamic'

const integer = new Intl.NumberFormat('pt-BR')

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
      {children}
    </div>
  )
}

// --- Filtros de produção (spec §6, task-9 brief) ---------------------------
// Same Link/tabs + querystring-preserving `buildHref` convention already used
// by app/(app)/filaments/page.tsx (material/stock/color tabs) and
// app/(app)/accessories/page.tsx (type/stock tabs) — status and wasteReason
// are small bounded enums so they become tabs; período (from/to, free dates)
// and produto/impressora (open-ended lists) go through a plain GET <form>
// instead, since a Link tab per date or per product doesn't scale the way it
// does for a 4- or 8-value enum.

const STATUS_VALUES: ProductionStatus[] = ['CONCLUIDA', 'PARCIAL', 'COM_FALHAS', 'CANCELADA']
const WASTE_REASON_VALUES = Object.keys(WASTE_REASON_LABELS) as WasteReason[]

interface DashboardFilterParams {
  from?: string
  to?: string
  productId?: string
  printerId?: string
  status?: string
  wasteReason?: string
}

function buildHref(params: DashboardFilterParams): string {
  const qs = new URLSearchParams()
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (params.productId) qs.set('productId', params.productId)
  if (params.printerId) qs.set('printerId', params.printerId)
  if (params.status) qs.set('status', params.status)
  if (params.wasteReason) qs.set('wasteReason', params.wasteReason)
  const s = qs.toString()
  return s ? `/dashboard?${s}` : '/dashboard'
}

function tabClass(isActive: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

// "to" is a date-only <input>, but ProductionRun.date can carry a time
// component -- without this, a run recorded later on the selected end day
// would be excluded by an implicit lte-at-midnight. Bumped to the end of that
// day so the range is inclusive of the whole day the user picked.
function parseDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  if (endOfDay) d.setHours(23, 59, 59, 999)
  return d
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardFilterParams>
}) {
  const sp = await searchParams
  const activeStatus = STATUS_VALUES.includes(sp.status as ProductionStatus) ? (sp.status as ProductionStatus) : undefined
  const activeWasteReason = WASTE_REASON_VALUES.includes(sp.wasteReason as WasteReason) ? (sp.wasteReason as WasteReason) : undefined
  const activeProductId = sp.productId || undefined
  const activePrinterId = sp.printerId || undefined
  const fromDate = parseDate(sp.from, false)
  const toDate = parseDate(sp.to, true)
  const hasProductionFilter = Boolean(activeStatus || activeWasteReason || activeProductId || activePrinterId || sp.from || sp.to)

  const productionFilters: ProductionReportFilters = {
    from: fromDate,
    to: toDate,
    productId: activeProductId,
    printerId: activePrinterId,
    status: activeStatus,
    wasteReason: activeWasteReason,
  }

  const [
    revenue,
    topProducts,
    consignmentStock,
    consignmentRevenue,
    productionSummary,
    productionByProduct,
    failuresByReason,
    printerUsage,
    filterProducts,
    filterPrinters,
    supplies,
    settings,
    platesInRangeCount,
    plateProductionByProduct,
  ] = await Promise.all([
    getRevenueByChannel(),
    getTopProducts(5),
    getConsignmentStockSummary(),
    getConsignmentRevenue(),
    getProductionSummary(productionFilters),
    getProductionByProduct(productionFilters),
    getFailuresByWasteReason(productionFilters),
    getPrinterUsage(productionFilters),
    prisma.product.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.printer.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.supply.findMany({ include: { purchases: { orderBy: { purchaseDate: 'desc' } } }, orderBy: { name: 'asc' } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.plate.count({ where: { date: { gte: fromDate, lte: toDate }, ...(activePrinterId ? { printerId: activePrinterId } : {}) } }),
    // Melhoria "Produção" (reformulação Plate) §6: "produtos completos vs.
    // parciais" -- sempre sobre TODO o histórico (não aplica os filtros de
    // período/status/motivo acima), mesmo padrão de getAssemblyOverview em
    // Meu Estoque (visão agregada, não uma lista filtrada).
    getPlateProductionByProduct(),
  ])

  const completeProductsCount = plateProductionByProduct.filter((p) => p.completeSets > 0).length
  const partialProductsCount = plateProductionByProduct.filter((p) => p.completeSets === 0).length

  // Card de alerta (spec do módulo Insumos): insumos esgotados ou em estoque
  // crítico, mesmo cálculo de status usado em app/(app)/supplies/page.tsx.
  const lowThresholdPercent = settings.stockLowThresholdPercent.toNumber()
  const criticalThresholdPercent = settings.stockCriticalThresholdPercent.toNumber()
  const criticalSupplies = supplies
    .map((s) => {
      const currentStock = s.currentStock.toNumber()
      const referenceQuantity = calculateStockReferenceQuantity(s.purchases.map((p) => p.quantity.toNumber()))
      const percentRemaining = calculateStockPercentRemaining(currentStock, referenceQuantity)
      const status = getStockStatusWithThresholds(percentRemaining, lowThresholdPercent, criticalThresholdPercent)
      return { id: s.id, name: s.name, status }
    })
    .filter((s) => s.status.label === 'Esgotado' || s.status.label === 'Estoque crítico')

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
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Visão geral</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Dashboard</h1>
      </header>

      {/* Hero: revenue is the headline number of the business — everything else is secondary. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Receita total</p>
            <p className="mt-1 font-display text-4xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-100 sm:text-5xl">
              {formatCurrency(totalRevenue)}
            </p>
          </div>
          <dl className="flex gap-8">
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Direta
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(revenue.DIRETA)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" /> Marketplace
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(revenue.MARKETPLACE)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Consignação
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(consignmentRevenue)}</dd>
            </div>
          </dl>
        </div>
        <div className="mt-6 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          {totalRevenue > 0 ? (
            <>
              <div className="h-full bg-emerald-500" style={{ width: `${diretaShare}%` }} />
              <div className="h-full bg-slate-300 dark:bg-slate-600" style={{ width: `${marketplaceShare}%` }} />
              <div className="h-full bg-amber-500" style={{ width: `${consignmentShare}%` }} />
            </>
          ) : null}
        </div>
      </section>

      {criticalSupplies.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900/50 dark:bg-red-500/10">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-red-800 dark:text-red-300">
              ⚠️ Insumos esgotados ou em estoque crítico
            </h2>
            <Link href="/supplies" className="text-xs font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-400">
              Ver insumos &rarr;
            </Link>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {criticalSupplies.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-red-800 dark:text-red-300">
                <span>{s.status.emoji}</span>
                <span className="font-medium">{s.name}</span>
                <span className="text-red-600 dark:text-red-400">— {s.status.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Secondary metric: consignment units are assets held by partners.
          Fix 3 (task-10 brief): the old "Custo total de desperdício" card
          here used to live-recalculate from CURRENT Printer/Filament/
          Settings for every historical run (lib/reports.ts's now-removed
          getTotalWasteCost) -- exactly what the costSnapshot mechanism
          (spec §4, Task 7) was built to eliminate. The "Desperdício total"
          card in the "Produção" section below (Task 9) already reads
          costSnapshot.wasteCost correctly and is the single source of truth
          for this number going forward, so the old contradicting card is
          removed rather than kept side-by-side with it. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Peças em consignação</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
            {integer.format(consignmentUnits)}
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Unidades entregues a parceiros, ainda não vendidas</p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Top 5 produtos mais vendidos</h2>
        {topProducts.length === 0 ? (
          <EmptyState>Nenhuma venda registrada ainda.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="w-12 py-3 pl-5"></th>
                  <th className="py-3">Produto</th>
                  <th className="py-3 pr-5 text-right">Unidades vendidas</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((entry, i) => (
                  <tr key={entry.product.id} className={i !== topProducts.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}>
                    <td className="py-3 pl-5">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                          i === 0
                            ? 'bg-amber-500 text-white dark:bg-amber-500 dark:text-slate-950'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-3 font-medium text-slate-800 dark:text-slate-200">{entry.product.name}</td>
                    <td className="py-3 pr-5 text-right tabular-nums text-slate-600 dark:text-slate-400">{integer.format(entry.quantitySold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Estoque em consignação por parceiro</h2>
        {consignmentStock.length === 0 ? (
          <EmptyState>Nenhum estoque em consignação no momento.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="py-3 pl-5">Parceiro / Produto</th>
                  <th className="py-3 pr-5 text-right">Saldo restante</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(consignmentByPartner).map(([partnerName, items]) => (
                  <Fragment key={partnerName}>
                    <tr className="border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60">
                      <td colSpan={2} className="py-2 pl-5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {partnerName}
                      </td>
                    </tr>
                    {items.map((item, i) => (
                      <tr
                        key={`${partnerName}-${item.productName}-${i}`}
                        className={i !== items.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}
                      >
                        <td className="py-3 pl-9 text-slate-700 dark:text-slate-300">{item.productName}</td>
                        <td className="py-3 pr-5 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">
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

      {/* Task 9 (spec §6): production indicators + filters + breakdown tables.
          Cards reuse the same rounded-2xl border/bg-white card and Link/tabs
          filter conventions as the rest of this page and app/(app)/filaments,
          app/(app)/accessories -- no new visual system. Every cost figure here
          sums each run's frozen costSnapshot.total (spec §4) instead of
          recalculating from current Settings/Printer/Filament/Accessory/
          Supply state. */}
      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Produção</h2>

        <form method="get" className="mb-2 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
          {activeWasteReason && <input type="hidden" name="wasteReason" value={activeWasteReason} />}
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
            De
            <input type="date" name="from" defaultValue={sp.from ?? ''} className="tk-input-full mt-1" />
          </label>
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Até
            <input type="date" name="to" defaultValue={sp.to ?? ''} className="tk-input-full mt-1" />
          </label>
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Produto
            <select name="productId" defaultValue={activeProductId ?? ''} className="tk-input-full mt-1">
              <option value="">Todos</option>
              {filterProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Impressora
            <select name="printerId" defaultValue={activePrinterId ?? ''} className="tk-input-full mt-1">
              <option value="">Todas</option>
              {filterPrinters.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white dark:bg-amber-500 dark:text-slate-950">
            Filtrar
          </button>
          {hasProductionFilter && (
            <Link href="/dashboard" className="text-sm font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400">
              Limpar filtros
            </Link>
          )}
        </form>

        <div className="mb-2 flex flex-wrap gap-1">
          <Link href={buildHref({ from: sp.from, to: sp.to, productId: activeProductId, printerId: activePrinterId, wasteReason: activeWasteReason })} className={tabClass(!activeStatus)}>
            Todos os status
          </Link>
          {STATUS_VALUES.map((status) => (
            <Link
              key={status}
              href={buildHref({ from: sp.from, to: sp.to, productId: activeProductId, printerId: activePrinterId, wasteReason: activeWasteReason, status })}
              className={tabClass(activeStatus === status)}
            >
              {getProductionStatusBadge(status).label}
            </Link>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap gap-1">
          <Link href={buildHref({ from: sp.from, to: sp.to, productId: activeProductId, printerId: activePrinterId, status: activeStatus })} className={tabClass(!activeWasteReason)}>
            Todos os motivos
          </Link>
          {WASTE_REASON_VALUES.map((reason) => (
            <Link
              key={reason}
              href={buildHref({ from: sp.from, to: sp.to, productId: activeProductId, printerId: activePrinterId, status: activeStatus, wasteReason: reason })}
              className={tabClass(activeWasteReason === reason)}
            >
              {WASTE_REASON_LABELS[reason]}
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Produções</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{integer.format(productionSummary.totalRuns)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Unidades produzidas</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{integer.format(productionSummary.totalUnitsProduced)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Taxa de sucesso</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{productionSummary.successRate.toFixed(1)}%</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Tempo total</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{productionSummary.totalTimeHours.toFixed(1)}h</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Custo total</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(productionSummary.totalCost)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Desperdício total</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(productionSummary.totalWasteCost)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Plates realizadas</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{integer.format(platesInRangeCount)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Produtos completos / parciais</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              <span className="text-emerald-600 dark:text-emerald-400">{integer.format(completeProductsCount)}</span>
              {' / '}
              <span className="text-amber-600 dark:text-amber-400">{integer.format(partialProductsCount)}</span>
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Produção por produto</h2>
        {productionByProduct.length === 0 ? (
          <EmptyState>Nenhuma produção registrada com esses filtros.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="py-3 pl-5">Produto</th>
                  <th className="py-3 text-right">Produções</th>
                  <th className="py-3 text-right">Unidades</th>
                  <th className="py-3 pr-5 text-right">Custo total</th>
                </tr>
              </thead>
              <tbody>
                {productionByProduct.map((row, i) => (
                  <tr key={row.productId} className={i !== productionByProduct.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}>
                    <td className="py-3 pl-5 font-medium text-slate-800 dark:text-slate-200">{row.productName}</td>
                    <td className="py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">{integer.format(row.runsCount)}</td>
                    <td className="py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">{integer.format(row.quantitySuccess)}</td>
                    <td className="py-3 pr-5 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">{formatCurrency(row.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Falhas por motivo</h2>
        {failuresByReason.length === 0 ? (
          <EmptyState>Nenhuma falha classificada com esses filtros.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="py-3 pl-5">Motivo</th>
                  <th className="py-3 text-right">Produções</th>
                  <th className="py-3 pr-5 text-right">Unidades falhadas</th>
                </tr>
              </thead>
              <tbody>
                {failuresByReason.map((row, i) => (
                  <tr key={row.wasteReason} className={i !== failuresByReason.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}>
                    <td className="py-3 pl-5 font-medium text-slate-800 dark:text-slate-200">{WASTE_REASON_LABELS[row.wasteReason]}</td>
                    <td className="py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">{integer.format(row.runsCount)}</td>
                    <td className="py-3 pr-5 text-right tabular-nums font-medium text-red-600 dark:text-red-400">{integer.format(row.quantityFailed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Impressoras mais usadas</h2>
        {printerUsage.length === 0 ? (
          <EmptyState>Nenhuma produção registrada com esses filtros.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="py-3 pl-5">Impressora</th>
                  <th className="py-3 text-right">Produções</th>
                  <th className="py-3 pr-5 text-right">Horas</th>
                </tr>
              </thead>
              <tbody>
                {printerUsage.map((row, i) => (
                  <tr key={row.printerId} className={i !== printerUsage.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}>
                    <td className="py-3 pl-5 font-medium text-slate-800 dark:text-slate-200">{row.printerName}</td>
                    <td className="py-3 text-right tabular-nums text-slate-600 dark:text-slate-400">{integer.format(row.runsCount)}</td>
                    <td className="py-3 pr-5 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">{row.totalHours.toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
