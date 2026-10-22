import { prisma } from '@/lib/prisma'
import { getSaleProfit } from '@/actions/sales'
import { getFilamentsLowStockCount, getConsignmentPartnerDetail, type DateRange, type ConsignmentPartnerDetail } from '@/lib/reports'
import {
  calculateStockReferenceQuantity,
  calculateStockPercentRemaining,
  getStockStatusWithThresholds,
  getPackagingStockStatus,
} from '@/lib/costing'

// Seletor de período GLOBAL do Dashboard: um só valor (querystring
// `periodo`, ou `from`/`to` livres) alimenta todas as abas.
export type PeriodKey = '7d' | '30d' | 'mes' | 'tudo' | 'custom'

export interface DashboardPeriod extends DateRange {
  key: PeriodKey
}

export const PERIOD_LABELS: Record<Exclude<PeriodKey, 'custom'>, string> = {
  '7d': '7 dias',
  '30d': '30 dias',
  mes: 'Este mês',
  tudo: 'Tudo',
}

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function endOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

function parseDay(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export function resolvePeriod(sp: { periodo?: string; from?: string; to?: string }, now = new Date()): DashboardPeriod {
  const customFrom = parseDay(sp.from)
  const customTo = parseDay(sp.to)
  if (customFrom || customTo) {
    return { key: 'custom', from: customFrom ? startOfDay(customFrom) : undefined, to: customTo ? endOfDay(customTo) : undefined }
  }
  const today = startOfDay(now)
  if (sp.periodo === '7d') return { key: '7d', from: new Date(today.getTime() - 6 * 86_400_000), to: endOfDay(now) }
  if (sp.periodo === '30d') return { key: '30d', from: new Date(today.getTime() - 29 * 86_400_000), to: endOfDay(now) }
  if (sp.periodo === 'mes') return { key: 'mes', from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) }
  return { key: 'tudo' }
}

function saleDateWhere(range: DateRange) {
  if (!range.from && !range.to) return undefined
  return { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) }
}

export interface ProfitSummary {
  // null = nenhuma venda do período tem custo congelado pra calcular lucro.
  profit: number | null
  salesCounted: number
  // Vendas antigas (anteriores ao custo congelado) ficam de FORA -- o custo
  // delas só existe recalculado "ao vivo", nunca um dado histórico real.
  salesSkipped: number
}

// Lucro por venda = preço − custo de produção (costSnapshot, que já embute
// embalagem conforme o flag de custo) − taxa da plataforma (idem) − frete
// (SaleFreight) − brinde (SaleGiftUsage). Frete/brinde são por LOTE de
// venda, descontados uma vez por lote que tenha ao menos uma linha contada.
export async function getProfitSummary(range: DateRange): Promise<ProfitSummary> {
  const sales = await prisma.sale.findMany({
    where: { saleDate: saleDateWhere(range) },
    select: { id: true, batchId: true, costSnapshot: true },
  })
  const counted = sales.filter((s) => s.costSnapshot !== null)
  if (counted.length === 0) return { profit: null, salesCounted: 0, salesSkipped: sales.length }

  const profits = await Promise.all(counted.map((s) => getSaleProfit(s.id)))
  const batchIds = [...new Set(counted.map((s) => s.batchId))]
  const [freights, gifts] = await Promise.all([
    prisma.saleFreight.findMany({ where: { batchId: { in: batchIds } } }),
    prisma.saleGiftUsage.findMany({ where: { batchId: { in: batchIds } } }),
  ])
  const freightTotal = freights.reduce((sum, f) => sum + f.amount.toNumber(), 0)
  const giftTotal = gifts.reduce((sum, g) => sum + g.quantity * g.unitCost.toNumber(), 0)
  const profit = profits.reduce((sum, p) => sum + p.profit, 0) - freightTotal - giftTotal
  return { profit, salesCounted: counted.length, salesSkipped: sales.length - counted.length }
}

export interface AttentionAlert {
  key: string
  label: string
  count: number
  // 'amount' = valor em R$ em vez de contagem
  amount?: number
  href: string
  tone: 'red' | 'amber' | 'blue' | 'green'
}

// Alertas operacionais lidos direto dos módulos de origem -- alerta com
// contagem zero nunca entra na lista.
export async function getAttentionAlerts(now = new Date()): Promise<AttentionAlert[]> {
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const openItem = { items: { some: { status: { notIn: ['ENTREGUE', 'CANCELADO'] as ('ENTREGUE' | 'CANCELADO')[] } } } }

  const [overdueOrders, todayOrders, awaitingProduction, filamentsEmpty, filamentsLow, packagings, supplies, settings, reports] = await Promise.all([
    prisma.order.count({ where: { ...openItem, deliveryDate: { lt: todayStart } } }),
    prisma.order.count({ where: { ...openItem, deliveryDate: { gte: todayStart, lte: todayEnd } } }),
    prisma.orderItem.count({ where: { status: { in: ['AGUARDANDO_PRODUCAO', 'PARCIAL_AGUARDANDO_PRODUCAO'] } } }),
    prisma.filament.count({ where: { currentStockGrams: { lte: 0 } } }),
    getFilamentsLowStockCount(),
    prisma.packagingItem.findMany({ where: { active: true }, select: { currentStock: true, minStock: true } }),
    prisma.supply.findMany({ include: { purchases: { select: { quantity: true } } } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.consignmentSaleReport.findMany({ include: { delivery: { select: { unitPrice: true } } } }),
  ])

  const packagingLow = packagings.filter((p) => getPackagingStockStatus(p.currentStock.toNumber(), p.minStock.toNumber()).label !== 'Em estoque').length
  const low = settings.stockLowThresholdPercent.toNumber()
  const critical = settings.stockCriticalThresholdPercent.toNumber()
  const suppliesCritical = supplies.filter((s) => {
    const ref = calculateStockReferenceQuantity(s.purchases.map((p) => p.quantity.toNumber()))
    const label = getStockStatusWithThresholds(calculateStockPercentRemaining(s.currentStock.toNumber(), ref), low, critical).label
    return label === 'Esgotado' || label === 'Estoque crítico'
  }).length
  const commissionOwed = reports.reduce(
    (sum, r) => sum + r.quantitySold * (r.unitPrice ?? r.delivery.unitPrice).toNumber() * r.commissionPercent.toNumber(),
    0,
  )

  const alerts: AttentionAlert[] = [
    { key: 'overdue', label: 'Pedidos atrasados', count: overdueOrders, href: '/orders', tone: 'red' },
    { key: 'today', label: 'Pedidos para entregar hoje', count: todayOrders, href: '/orders', tone: 'amber' },
    { key: 'awaiting', label: 'Itens aguardando produção', count: awaitingProduction, href: '/production', tone: 'blue' },
    { key: 'filaments-empty', label: 'Filamentos esgotados', count: filamentsEmpty, href: '/filaments', tone: 'red' },
    { key: 'filaments-low', label: 'Filamentos com estoque baixo', count: filamentsLow, href: '/filaments', tone: 'amber' },
    { key: 'packaging', label: 'Embalagens zeradas ou abaixo do mínimo', count: packagingLow, href: '/packaging', tone: 'red' },
    { key: 'supplies', label: 'Insumos esgotados ou críticos', count: suppliesCritical, href: '/supplies', tone: 'red' },
    { key: 'commission', label: 'Comissão a pagar a parceiros', count: commissionOwed > 0 ? 1 : 0, amount: commissionOwed, href: '/consignment/partners', tone: 'green' },
  ]
  return alerts.filter((a) => a.count > 0)
}

export interface PartnerStock {
  partnerId: string
  partnerName: string
  totalUnits: number
  products: { productId: string; productName: string; remaining: number; variants: { key: string | null; label: string | null; remaining: number; attrs: ConsignmentPartnerDetail['products'][number]['variants'][number]['attrs'] }[] }[]
}

// Estoque em consignação agrupado por parceiro e, dentro dele, UMA linha por
// produto (saldo somado + variações com saldo > 0) -- reaproveita a mesma
// fonte da página do parceiro (getConsignmentPartnerDetail), nunca um
// cálculo paralelo.
export async function getConsignmentStockByPartner(): Promise<PartnerStock[]> {
  const partners = await prisma.consignmentPartner.findMany({ where: { active: true }, select: { id: true }, orderBy: { name: 'asc' } })
  const details = await Promise.all(partners.map((p) => getConsignmentPartnerDetail(p.id)))
  return details
    .filter((d): d is ConsignmentPartnerDetail => d !== null)
    .map((d) => {
      const products = d.products
        .map((p) => ({
          productId: p.productId,
          productName: p.productName,
          remaining: p.remaining,
          variants: p.variants
            .filter((v) => v.remaining > 0)
            .map((v) => ({ key: v.key, label: v.label, remaining: v.remaining, attrs: v.attrs })),
        }))
        .filter((p) => p.remaining > 0)
        .sort((a, b) => b.remaining - a.remaining || a.productName.localeCompare(b.productName))
      return { partnerId: d.partnerId, partnerName: d.partnerName, totalUnits: products.reduce((s, p) => s + p.remaining, 0), products }
    })
    .filter((p) => p.products.length > 0)
}
