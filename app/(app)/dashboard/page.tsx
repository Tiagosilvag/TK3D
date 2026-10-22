import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import {
  getRevenueByChannel,
  getTopProducts,
  getConsignmentStockSummary,
  getConsignmentSoldSummary,
  getConsignmentRevenue,
  getProductionSummary,
  getProductionByProduct,
  getFailuresByWasteReason,
  getPrinterUsage,
  type ProductionReportFilters,
} from '@/lib/reports'
// "Produtos completos / parciais" reaproveita getProductionByProduct de
// actions/productionRuns.ts (traz completeSets via getAssemblyStatus);
// aliado pra não colidir com o getProductionByProduct de lib/reports acima
// (função diferente, shape diferente, mesmo nome por coincidência).
import { getProductionByProduct as getPlateProductionByProduct } from '@/actions/productionRuns'
import { formatCurrency, getProductionStatusBadge, WASTE_REASON_LABELS } from '@/lib/format'
import { getAttentionAlerts, getConsignmentStockByPartner, getProfitSummary, resolvePeriod, PERIOD_LABELS, type AttentionAlert } from '@/lib/dashboard'
import type { ProductionStatus, WasteReason } from '@prisma/client'
import { UrlSelect } from './UrlSelect'
import { ConsignmentStockList } from './ConsignmentStockList'
import { ProductionByProductTable } from './ProductionByProductTable'

// Agrega dados mutados por actions de várias outras rotas (produção,
// consignação, vendas) que só revalidam o próprio path -- sempre dinâmico.
export const dynamic = 'force-dynamic'

const integer = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const STATUS_VALUES: ProductionStatus[] = ['CONCLUIDA', 'PARCIAL', 'COM_FALHAS', 'CANCELADA']
const WASTE_REASON_VALUES = Object.keys(WASTE_REASON_LABELS) as WasteReason[]
const TABS = [
  { key: 'geral', label: 'Visão geral' },
  { key: 'consignacao', label: 'Consignação' },
  { key: 'producao', label: 'Produção' },
] as const
type TabKey = (typeof TABS)[number]['key']

interface DashboardParams {
  aba?: string
  periodo?: string
  from?: string
  to?: string
  productId?: string
  printerId?: string
  status?: string
  wasteReason?: string
  parceiro?: string
}

function buildHref(sp: DashboardParams, overrides: Partial<Record<keyof DashboardParams, string | null>>): string {
  const merged: Record<string, string | null | undefined> = { ...sp, ...overrides }
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `/dashboard?${s}` : '/dashboard'
}

const card = 'rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
      {children}
    </div>
  )
}

function tabClass(active: boolean): string {
  return `border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? 'border-violet-600 text-slate-900 dark:border-violet-400 dark:text-slate-100'
      : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
  }`
}

function pillClass(active: boolean): string {
  return `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
    active
      ? 'bg-violet-600 text-white dark:bg-violet-500 dark:text-slate-950'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
  }`
}

const ALERT_TONE: Record<AttentionAlert['tone'], string> = {
  red: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
}

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </div>
  )
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardParams> }) {
  const sp = await searchParams
  const tab: TabKey = TABS.some((t) => t.key === sp.aba) ? (sp.aba as TabKey) : 'geral'
  const period = resolvePeriod(sp)
  const range = { from: period.from, to: period.to }

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Visão geral</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Dashboard</h1>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-800" role="group" aria-label="Período">
          {(Object.keys(PERIOD_LABELS) as (keyof typeof PERIOD_LABELS)[]).map((key) => (
            <Link key={key} href={buildHref(sp, { periodo: key === 'tudo' ? null : key, from: null, to: null })} className={pillClass(period.key === key)}>
              {PERIOD_LABELS[key]}
            </Link>
          ))}
        </div>
        <form method="get" className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {Object.entries({ aba: sp.aba, productId: sp.productId, printerId: sp.printerId, status: sp.status, wasteReason: sp.wasteReason, parceiro: sp.parceiro }).map(([k, v]) =>
            v ? <input key={k} type="hidden" name={k} value={v} /> : null,
          )}
          <span className={period.key === 'custom' ? 'font-medium text-violet-600 dark:text-violet-400' : ''}>Personalizado:</span>
          <input type="date" name="from" defaultValue={sp.from ?? ''} aria-label="De" className="tk-input-full" />
          <span>até</span>
          <input type="date" name="to" defaultValue={sp.to ?? ''} aria-label="Até" className="tk-input-full" />
          <button type="submit" className="rounded-md border border-slate-200 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Aplicar
          </button>
        </form>
      </div>
    </header>
  )

  const tabs = (
    <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800" aria-label="Seções do dashboard">
      {TABS.map((t) => (
        <Link key={t.key} href={buildHref(sp, { aba: t.key === 'geral' ? null : t.key })} className={tabClass(tab === t.key)}>
          {t.label}
        </Link>
      ))}
    </nav>
  )

  // ------------------------------------------------------------------ Visão geral
  if (tab === 'geral') {
    const [revenue, consignmentRevenue, topProducts, consignmentStock, consignmentSold, productionSummary, profit, alerts] = await Promise.all([
      getRevenueByChannel(range),
      getConsignmentRevenue(range),
      getTopProducts(5, range),
      getConsignmentStockSummary(),
      getConsignmentSoldSummary(range),
      getProductionSummary(range),
      getProfitSummary(range),
      getAttentionAlerts(),
    ])
    const totalRevenue = revenue.DIRETA + revenue.MARKETPLACE + consignmentRevenue
    const share = (v: number) => (totalRevenue > 0 ? (v / totalRevenue) * 100 : 0)
    const consignmentUnits = consignmentStock.reduce((s, r) => s + r.remaining, 0)
    const consignmentValue = consignmentStock.reduce((s, r) => s + r.remainingValue, 0)
    const topMax = topProducts[0]?.quantitySold ?? 0

    const channels = [
      { label: 'Direta', value: revenue.DIRETA, dot: 'bg-emerald-500' },
      { label: 'Marketplace', value: revenue.MARKETPLACE, dot: 'bg-slate-400 dark:bg-slate-500' },
      { label: 'Consignação', value: consignmentRevenue, dot: 'bg-amber-500' },
    ]

    const kpis = [
      { label: 'Peças com parceiros', value: integer.format(consignmentUnits), sub: `${formatCurrency(consignmentValue)} · ainda não vendidas`, href: buildHref(sp, { aba: 'consignacao' }) },
      { label: 'Vendido em consignação', value: integer.format(consignmentSold.totalUnitsSold), sub: `${formatCurrency(consignmentSold.totalGrossValue)} bruto`, href: buildHref(sp, { aba: 'consignacao' }) },
      { label: 'Unidades produzidas', value: integer.format(productionSummary.totalUnitsProduced), sub: `${integer.format(productionSummary.totalRuns)} produções`, href: buildHref(sp, { aba: 'producao' }) },
      { label: 'Taxa de sucesso', value: `${percent.format(productionSummary.successRate)}%`, sub: `${integer.format(productionSummary.totalUnitsFailed)} unidades falhadas`, href: buildHref(sp, { aba: 'producao' }) },
    ]

    return (
      <div className="mx-auto max-w-5xl space-y-6 p-0 sm:p-6">
        {header}
        {tabs}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className={`${card} p-5 sm:p-6 lg:col-span-2`}>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Receita total</p>
            <p className="mt-1 font-display text-4xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">{formatCurrency(totalRevenue)}</p>
            <div className="mt-5 flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              {totalRevenue > 0 && (
                <>
                  <div className="h-full bg-emerald-500" style={{ width: `${share(revenue.DIRETA)}%` }} />
                  <div className="h-full bg-slate-400 dark:bg-slate-500" style={{ width: `${share(revenue.MARKETPLACE)}%` }} />
                  <div className="h-full bg-amber-500" style={{ width: `${share(consignmentRevenue)}%` }} />
                </>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {channels.map((c) => (
                <div key={c.label}>
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <span className={`h-2 w-2 rounded-full ${c.dot}`} /> {c.label}
                  </dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(c.value)}</dd>
                  <dd className="text-xs text-slate-400 dark:text-slate-500">{percent.format(share(c.value))}% da receita</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={`${card} p-5 sm:p-6`}>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Lucro estimado</p>
            {profit.profit === null ? (
              <>
                <p className="mt-1 font-display text-4xl font-semibold tabular-nums text-slate-300 dark:text-slate-600">R$ —</p>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Nenhuma venda do período tem custo registrado para calcular o lucro. Aparece assim que houver vendas com custo congelado.
                </p>
              </>
            ) : (
              <>
                <p className={`mt-1 font-display text-4xl font-semibold tabular-nums ${profit.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                  {formatCurrency(profit.profit)}
                </p>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Preço − custo de produção (com embalagem) − taxa da plataforma − frete − brinde, somado sobre {integer.format(profit.salesCounted)} {profit.salesCounted === 1 ? 'venda' : 'vendas'} diretas e de marketplace.
                  {profit.salesSkipped > 0 && ` ${integer.format(profit.salesSkipped)} ${profit.salesSkipped === 1 ? 'venda antiga' : 'vendas antigas'} sem custo congelado ficou de fora.`} Não inclui consignação.
                </p>
              </>
            )}
          </section>
        </div>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className={`${card} p-4 transition-colors hover:border-violet-400 dark:hover:border-violet-500`}>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{k.label}</p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{k.value}</p>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{k.sub}</p>
            </Link>
          ))}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className={`${card} p-5`}>
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Precisa de atenção</h2>
            {alerts.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">Nada pendente agora.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {alerts.map((a) => (
                  <li key={a.key}>
                    <Link href={a.href} className="flex items-center justify-between gap-3 py-2.5 text-sm text-slate-700 hover:text-violet-600 dark:text-slate-300 dark:hover:text-violet-400">
                      <span>{a.label}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${ALERT_TONE[a.tone]}`}>
                        {a.amount !== undefined ? formatCurrency(a.amount) : integer.format(a.count)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${card} p-5`}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Top 5 mais vendidos</h2>
              <span className="text-xs text-slate-400 dark:text-slate-500">unidades</span>
            </div>
            {topProducts.length === 0 ? (
              <div className="mt-3"><EmptyState>Nenhuma venda no período.</EmptyState></div>
            ) : (
              <ol className="mt-3 space-y-3">
                {topProducts.map((entry, i) => (
                  <li key={entry.product.id}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i === 0 ? 'bg-amber-500 text-white dark:text-slate-950' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{i + 1}</span>
                        <span className="truncate font-medium text-slate-800 dark:text-slate-200">{entry.product.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-400">{integer.format(entry.quantitySold)}</span>
                    </div>
                    <Bar value={entry.quantitySold} max={topMax} className="bg-violet-500 dark:bg-violet-400" />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------------ Consignação
  if (tab === 'consignacao') {
    const [soldSummary, partnersStock] = await Promise.all([getConsignmentSoldSummary(range), getConsignmentStockByPartner()])
    const net = soldSummary.totalGrossValue - soldSummary.totalCommission
    const selectedPartner = partnersStock.some((p) => p.partnerId === sp.parceiro) ? sp.parceiro! : ''
    const shownPartners = selectedPartner ? partnersStock.filter((p) => p.partnerId === selectedPartner) : partnersStock

    return (
      <div className="mx-auto max-w-5xl space-y-6 p-0 sm:p-6">
        {header}
        {tabs}

        <section className={`${card} p-5 sm:p-6`}>
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Do vendido ao que entra na receita</h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Vendido pelos parceiros (bruto)</dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(soldSummary.totalGrossValue)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">− Comissão dos parceiros</dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(soldSummary.totalCommission)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">= Entra na receita (líquido)</dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(net)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            {integer.format(soldSummary.totalUnitsSold)} peças vendidas no período. A comissão é a soma da comissão registrada em cada venda de cada parceiro.
          </p>
        </section>

        {partnersStock.length === 0 ? (
          <EmptyState>Nenhum estoque em consignação no momento.</EmptyState>
        ) : (
          <>
            {partnersStock.length > 1 && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Parceiro</span>
                <UrlSelect
                  name="parceiro"
                  label="Parceiro"
                  value={selectedPartner}
                  allLabel="Todos"
                  options={partnersStock.map((p) => ({ value: p.partnerId, label: p.partnerName }))}
                />
              </div>
            )}
            <ConsignmentStockList partners={shownPartners} />
            <p className="text-xs text-slate-400 dark:text-slate-500">O estoque com parceiros é a posição de agora, não depende do período.</p>
          </>
        )}
      </div>
    )
  }

  // ------------------------------------------------------------------ Produção
  const activeStatus = STATUS_VALUES.includes(sp.status as ProductionStatus) ? (sp.status as ProductionStatus) : undefined
  const activeWasteReason = WASTE_REASON_VALUES.includes(sp.wasteReason as WasteReason) ? (sp.wasteReason as WasteReason) : undefined
  const productionFilters: ProductionReportFilters = {
    ...range,
    productId: sp.productId || undefined,
    printerId: sp.printerId || undefined,
    status: activeStatus,
    wasteReason: activeWasteReason,
  }

  const [summary, byProduct, failures, printerUsage, filterProducts, filterPrinters, platesCount, completeness] = await Promise.all([
    getProductionSummary(productionFilters),
    getProductionByProduct(productionFilters),
    getFailuresByWasteReason(productionFilters),
    getPrinterUsage(productionFilters),
    // Brinde nunca tem produção -- fora do filtro.
    prisma.product.findMany({ where: { isGift: false }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.printer.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.plate.count({
      where: {
        ...(range.from || range.to ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } : {}),
        ...(productionFilters.printerId ? { printerId: productionFilters.printerId } : {}),
        ...(productionFilters.productId ? { runs: { some: { productId: productionFilters.productId } } } : {}),
      },
    }),
    // Sempre sobre TODO o histórico (visão agregada, não lista filtrada).
    getPlateProductionByProduct(),
  ])

  const completeCount = completeness.filter((p) => p.completeSets > 0).length
  const partialCount = completeness.filter((p) => p.completeSets === 0).length
  const totalPrinterHours = printerUsage.reduce((s, r) => s + r.totalHours, 0)
  const maxFailed = failures[0]?.quantityFailed ?? 0
  const unitCost = summary.totalUnitsProduced > 0 ? summary.totalCost / summary.totalUnitsProduced : 0
  const wastePercent = summary.totalCost > 0 ? (summary.totalWasteCost / summary.totalCost) * 100 : 0

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-0 sm:p-6">
      {header}
      {tabs}

      <div className="flex flex-wrap items-center gap-2">
        <UrlSelect name="productId" label="Produto" value={sp.productId ?? ''} allLabel="Todos os produtos" options={filterProducts.map((p) => ({ value: p.id, label: p.name }))} />
        <UrlSelect name="printerId" label="Impressora" value={sp.printerId ?? ''} allLabel="Todas as impressoras" options={filterPrinters.map((p) => ({ value: p.id, label: p.name }))} />
        <UrlSelect name="status" label="Status" value={activeStatus ?? ''} allLabel="Todos os status" options={STATUS_VALUES.map((s) => ({ value: s, label: getProductionStatusBadge(s).label }))} />
        <UrlSelect name="wasteReason" label="Motivo" value={activeWasteReason ?? ''} allLabel="Todos os motivos" options={WASTE_REASON_VALUES.map((r) => ({ value: r, label: WASTE_REASON_LABELS[r] }))} />
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`${card} p-5`}>
          <p className="text-sm text-slate-500 dark:text-slate-400">Unidades produzidas</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{integer.format(summary.totalUnitsProduced)}</p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{integer.format(summary.totalRuns)} produções</p>
        </div>
        <div className={`${card} p-5`}>
          <p className="text-sm text-slate-500 dark:text-slate-400">Taxa de sucesso</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{percent.format(summary.successRate)}%</p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">unidades boas ÷ planejadas · {integer.format(summary.totalUnitsFailed)} falhadas</p>
        </div>
        <div className={`${card} p-5`}>
          <p className="text-sm text-slate-500 dark:text-slate-400">Custo total</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(summary.totalCost)}</p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">≈ {formatCurrency(unitCost)} por unidade</p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={`${card} p-4`}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Tempo total</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{percent.format(summary.totalTimeHours)} h</p>
        </div>
        <div className={`${card} p-4`}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Desperdício</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(summary.totalWasteCost)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{percent.format(wastePercent)}% do custo</p>
        </div>
        <div className={`${card} p-4`}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Plates realizadas</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{integer.format(platesCount)}</p>
        </div>
        <div className={`${card} p-4`}>
          <p className="text-xs text-slate-500 dark:text-slate-400">Completos / parciais</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">{integer.format(completeCount)}</span>
            <span className="text-slate-400"> / </span>
            <span className="text-amber-600 dark:text-amber-400">{integer.format(partialCount)}</span>
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={`${card} p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Impressoras mais usadas</h2>
            <span className="text-xs text-slate-400 dark:text-slate-500">% das horas</span>
          </div>
          {printerUsage.length === 0 ? (
            <div className="mt-3"><EmptyState>Nenhuma produção com esses filtros.</EmptyState></div>
          ) : (
            <ul className="mt-3 space-y-4">
              {printerUsage.map((row) => {
                const pct = totalPrinterHours > 0 ? (row.totalHours / totalPrinterHours) * 100 : 0
                return (
                  <li key={row.printerId}>
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{row.printerName}</span>
                      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {integer.format(row.runsCount)} produções · {percent.format(row.totalHours)} h · {Math.round(pct)}%
                      </span>
                    </div>
                    <Bar value={row.totalHours} max={totalPrinterHours} className="bg-violet-500 dark:bg-violet-400" />
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className={`${card} p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Falhas por motivo</h2>
            <span className="text-xs text-slate-400 dark:text-slate-500">unidades</span>
          </div>
          {failures.length === 0 ? (
            <div className="mt-3"><EmptyState>Nenhuma falha classificada com esses filtros.</EmptyState></div>
          ) : (
            <ul className="mt-3 space-y-4">
              {failures.map((row) => (
                <li key={row.wasteReason}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{WASTE_REASON_LABELS[row.wasteReason]}</span>
                    <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{integer.format(row.quantityFailed)} un.</span>
                  </div>
                  <Bar value={row.quantityFailed} max={maxFailed} className="bg-red-500 dark:bg-red-400" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ProductionByProductTable rows={byProduct} />
    </div>
  )
}
