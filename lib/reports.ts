import { prisma } from '@/lib/prisma'
import type { ProductionCostSnapshot } from '@/lib/costing'
import type { Prisma, ProductionStatus, WasteReason } from '@prisma/client'

// 3.6 estendeu SaleChannel com SHOPEE/MERCADO_LIVRE (além do MARKETPLACE
// legado) -- pro Dashboard, que só distingue Direta vs Marketplace no
// gráfico de participação, os três contam pro mesmo balde "MARKETPLACE".
export async function getRevenueByChannel(): Promise<Record<'DIRETA' | 'MARKETPLACE', number>> {
  const sales = await prisma.sale.findMany()
  const result = { DIRETA: 0, MARKETPLACE: 0 }
  for (const s of sales) {
    const bucket = s.channel === 'DIRETA' ? 'DIRETA' : 'MARKETPLACE'
    result[bucket] += s.quantity * s.unitPrice.toNumber()
  }
  return result
}

export async function getConsignmentRevenue(): Promise<number> {
  const reports = await prisma.consignmentSaleReport.findMany({ include: { delivery: true } })
  return reports.reduce((sum, r) => {
    const unitPrice = r.delivery.unitPrice.toNumber()
    const commission = r.commissionPercent.toNumber()
    return sum + r.quantitySold * unitPrice * (1 - commission)
  }, 0)
}

export async function getTopProducts(limit = 5) {
  const grouped = await prisma.sale.groupBy({
    by: ['productId'],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  })
  const products = await prisma.product.findMany({ where: { id: { in: grouped.map((g) => g.productId) } } })
  return grouped.map((g) => ({
    product: products.find((p) => p.id === g.productId)!,
    quantitySold: g._sum.quantity ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// Dashboard de produção (spec §6, task-9 brief).
//
// Every ProductionRun's cost is read from its own `costSnapshot` -- computed
// ONCE at creation time (Task 5/7, lib/costing.ts#buildProductionCostSnapshot)
// and never rewritten. These aggregations sum that frozen field; they never
// recompute cost from current Settings/Printer/Filament/Accessory/Supply
// state, matching spec §4's "altering a global setting must never change the
// historical cost of an already-recorded run" rule (same rule Task 8's
// history table follows for its "Custo" column).
//
// costSnapshot is nullable only for rows created before Task 7 added the
// column (see prisma/schema.prisma's doc comment on it) -- there is no
// historical Printer/Filament/Settings state to reconstruct one for them, so
// such legacy runs contribute 0 to totalCost/totalWasteCost here (same "—"
// treatment the production history table gives them) while still counting
// toward totalRuns/totalUnitsProduced/totalTimeHours, which don't depend on
// the snapshot.
// ---------------------------------------------------------------------------

export interface ProductionReportFilters {
  from?: Date
  to?: Date
  productId?: string
  printerId?: string
  status?: ProductionStatus
  wasteReason?: WasteReason
}

function buildProductionRunWhere(filters: ProductionReportFilters): Prisma.ProductionRunWhereInput {
  const where: Prisma.ProductionRunWhereInput = {}
  if (filters.from || filters.to) {
    where.date = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    }
  }
  if (filters.productId) where.productId = filters.productId
  if (filters.printerId) where.printerId = filters.printerId
  if (filters.status) where.status = filters.status
  if (filters.wasteReason) where.wasteReason = filters.wasteReason
  return where
}

// Shared fetch used by every report function below -- keeps the Prisma
// `where` construction and the `include`s (product/printer, needed for
// printTimeHours/grouping) in one place instead of duplicated per function.
async function getFilteredProductionRuns(filters: ProductionReportFilters) {
  return prisma.productionRun.findMany({
    where: buildProductionRunWhere(filters),
    include: { product: true, printer: true },
  })
}

function readSnapshot(run: { costSnapshot: unknown }): ProductionCostSnapshot | null {
  return run.costSnapshot as ProductionCostSnapshot | null
}

// Fix 5 (task-10 brief): a CANCELADA run had every resource it consumed
// fully reversed by cancelProductionRun (spec §5.5) -- it represents zero
// real incurred cost, so it must NOT inflate "Custo total"/"Desperdício
// total" by default. It still keeps its own frozen costSnapshot (never
// rewritten, same as any other run) so its cost isn't lost -- it just isn't
// counted automatically. The one exception: if the caller explicitly asked
// to filter down to status=CANCELADA (they deliberately want to inspect
// cancelled runs), its cost IS counted for that explicit view -- the
// existing status filter still lets a user see it if they choose, per the
// brief.
function shouldCountCost(run: { status: ProductionStatus }, filters: ProductionReportFilters): boolean {
  if (run.status !== 'CANCELADA') return true
  return filters.status === 'CANCELADA'
}

export interface ProductionSummary {
  totalRuns: number
  totalUnitsProduced: number
  successRate: number // 0-100, sum(quantitySuccess) / sum(quantityPlanned)
  totalTimeHours: number
  totalCost: number
  totalWasteCost: number
}

export async function getProductionSummary(filters: ProductionReportFilters = {}): Promise<ProductionSummary> {
  const runs = await getFilteredProductionRuns(filters)

  let totalUnitsProduced = 0
  let totalPlanned = 0
  let totalTimeHours = 0
  let totalCost = 0
  let totalWasteCost = 0

  for (const run of runs) {
    totalUnitsProduced += run.quantitySuccess
    totalPlanned += run.quantityPlanned
    totalTimeHours += run.product.printTimeHours.toNumber() * run.quantitySuccess + run.timeWastedHours.toNumber()
    const snapshot = readSnapshot(run)
    if (snapshot && shouldCountCost(run, filters)) {
      totalCost += snapshot.total
      totalWasteCost += snapshot.wasteCost
    }
  }

  return {
    totalRuns: runs.length,
    totalUnitsProduced,
    successRate: totalPlanned > 0 ? (totalUnitsProduced / totalPlanned) * 100 : 0,
    totalTimeHours,
    totalCost,
    totalWasteCost,
  }
}

export interface ProductionByProductRow {
  productId: string
  productName: string
  runsCount: number
  quantitySuccess: number
  totalCost: number
}

export async function getProductionByProduct(filters: ProductionReportFilters = {}): Promise<ProductionByProductRow[]> {
  const runs = await getFilteredProductionRuns(filters)
  const byProduct = new Map<string, ProductionByProductRow>()

  for (const run of runs) {
    const row = byProduct.get(run.productId) ?? {
      productId: run.productId,
      productName: run.product.name,
      runsCount: 0,
      quantitySuccess: 0,
      totalCost: 0,
    }
    row.runsCount += 1
    row.quantitySuccess += run.quantitySuccess
    const snapshot = readSnapshot(run)
    if (snapshot && shouldCountCost(run, filters)) row.totalCost += snapshot.total
    byProduct.set(run.productId, row)
  }

  return [...byProduct.values()].sort((a, b) => b.quantitySuccess - a.quantitySuccess)
}

export interface FailuresByWasteReasonRow {
  wasteReason: WasteReason
  runsCount: number
  quantityFailed: number
}

// Only runs with a classified wasteReason are grouped here -- a run can have
// quantityFailed > 0 without a wasteReason set (it's optional, spec §5.4), and
// such unclassified failures don't belong to any reason bucket.
export async function getFailuresByWasteReason(filters: ProductionReportFilters = {}): Promise<FailuresByWasteReasonRow[]> {
  const runs = await getFilteredProductionRuns(filters)
  const byReason = new Map<WasteReason, FailuresByWasteReasonRow>()

  for (const run of runs) {
    if (!run.wasteReason) continue
    const row = byReason.get(run.wasteReason) ?? { wasteReason: run.wasteReason, runsCount: 0, quantityFailed: 0 }
    row.runsCount += 1
    row.quantityFailed += run.quantityFailed
    byReason.set(run.wasteReason, row)
  }

  return [...byReason.values()].sort((a, b) => b.quantityFailed - a.quantityFailed)
}

export interface PrinterUsageRow {
  printerId: string
  printerName: string
  runsCount: number
  totalHours: number
}

export async function getPrinterUsage(filters: ProductionReportFilters = {}): Promise<PrinterUsageRow[]> {
  const runs = await getFilteredProductionRuns(filters)
  const byPrinter = new Map<string, PrinterUsageRow>()

  for (const run of runs) {
    const row = byPrinter.get(run.printerId) ?? {
      printerId: run.printerId,
      printerName: run.printer.name,
      runsCount: 0,
      totalHours: 0,
    }
    row.runsCount += 1
    row.totalHours += run.product.printTimeHours.toNumber() * run.quantitySuccess + run.timeWastedHours.toNumber()
    byPrinter.set(run.printerId, row)
  }

  return [...byPrinter.values()].sort((a, b) => b.runsCount - a.runsCount)
}

// 2.2 Estoque próprio de produtos acabados: tudo derivado das tabelas que já
// existem (ProductionRun/Sale/ConsignmentDelivery) -- sem ledger novo,
// então não há segunda fonte de verdade pra divergir do que as outras
// telas já mostram. Fórmula do módulo: disponível = produzido - vendido
// diretamente - entregue a parceiros.
//
// "Produzido" de um produto SIMPLES soma ProductionRun.quantitySuccess
// (productPartId null, status != CANCELADA) direto. De um produto
// COMPOSTO soma ProductAssembly.quantity (2.3) -- uma produção de PEÇA
// isolada (productPartId setado) não vira estoque de produto acabado até
// passar pela montagem; só a montagem confirmada conta como "produzido".
//
// "Em produção" soma Order.quantity com status != CONCLUIDO (2.4) --
// qualquer pedido ainda no pipeline (Recebido/Em produção/Pronto/
// Despachado) conta como "ordem aberta"; ao concluir, vira Sale e some
// daqui (já não é mais "em produção", é venda).
export interface OwnStockRow {
  productId: string
  productName: string
  isComposite: boolean
  produced: number
  soldDirect: number
  deliveredToPartners: number
  consignmentRemaining: number
  inProduction: number
  available: number
}

export async function getOwnStockSummary(): Promise<OwnStockRow[]> {
  const [products, producedByProduct, assembledByProduct, soldByProduct, deliveries, openOrdersByProduct] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.productionRun.groupBy({
      by: ['productId'],
      where: { productPartId: null, status: { not: 'CANCELADA' } },
      _sum: { quantitySuccess: true },
    }),
    prisma.productAssembly.groupBy({ by: ['productId'], _sum: { quantity: true } }),
    prisma.sale.groupBy({ by: ['productId'], _sum: { quantity: true } }),
    prisma.consignmentDelivery.findMany({ include: { saleReports: true } }),
    prisma.order.groupBy({ by: ['productId'], where: { status: { not: 'CONCLUIDO' } }, _sum: { quantity: true } }),
  ])

  // 2.6: ajustes de estoque de Product são o único termo que não tem uma
  // tabela própria pra somar -- StockAdjustment.difference (positivo ou
  // negativo) entra direto na fórmula de disponível.
  const productAdjustments = await prisma.stockAdjustment.groupBy({
    by: ['resourceId'],
    where: { resourceType: 'PRODUCT' },
    _sum: { difference: true },
  })
  const adjustmentMap = new Map(productAdjustments.map((a) => [a.resourceId, a._sum.difference?.toNumber() ?? 0]))

  const producedMap = new Map(producedByProduct.map((p) => [p.productId, p._sum.quantitySuccess ?? 0]))
  const assembledMap = new Map(assembledByProduct.map((a) => [a.productId, a._sum.quantity ?? 0]))
  const soldMap = new Map(soldByProduct.map((s) => [s.productId, s._sum.quantity ?? 0]))
  const openOrdersMap = new Map(openOrdersByProduct.map((o) => [o.productId, o._sum.quantity ?? 0]))
  const deliveredMap = new Map<string, { delivered: number; consignmentSold: number }>()
  for (const d of deliveries) {
    const entry = deliveredMap.get(d.productId) ?? { delivered: 0, consignmentSold: 0 }
    entry.delivered += d.quantityDelivered
    entry.consignmentSold += d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
    deliveredMap.set(d.productId, entry)
  }

  return products.map((p) => {
    const produced = p.isComposite ? (assembledMap.get(p.id) ?? 0) : (producedMap.get(p.id) ?? 0)
    const soldDirect = soldMap.get(p.id) ?? 0
    const delivery = deliveredMap.get(p.id) ?? { delivered: 0, consignmentSold: 0 }
    const adjustment = adjustmentMap.get(p.id) ?? 0
    return {
      productId: p.id,
      productName: p.name,
      isComposite: p.isComposite,
      produced,
      soldDirect,
      deliveredToPartners: delivery.delivered,
      consignmentRemaining: delivery.delivered - delivery.consignmentSold,
      inProduction: openOrdersMap.get(p.id) ?? 0,
      available: produced - soldDirect - delivery.delivered + adjustment,
    }
  })
}

// 2.5 Estoque por parceiro aprimorado: saldo agregado por parceiro+produto
// (múltiplas entregas do mesmo produto pro mesmo parceiro somadas, não uma
// linha por entrega crua como getConsignmentStockSummary abaixo) + um
// histórico cronológico misturando entregas e relatórios de venda -- tudo
// derivado de ConsignmentDelivery/ConsignmentSaleReport, que já são a
// única fonte real dessa informação (um relatório de venda continua sendo
// preenchido manualmente porque é informação que só o parceiro tem — o que
// fica automático aqui é a agregação/relatório em cima disso, não a
// captura do evento em si).
export interface ConsignmentHistoryEvent {
  date: Date
  type: 'entrega' | 'venda'
  productName: string
  quantity: number
}

export interface ConsignmentPartnerSummary {
  partnerId: string
  partnerName: string
  products: { productName: string; delivered: number; sold: number; remaining: number }[]
  history: ConsignmentHistoryEvent[]
}

export async function getConsignmentPartnerSummary(): Promise<ConsignmentPartnerSummary[]> {
  const partners = await prisma.consignmentPartner.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    include: {
      deliveries: {
        include: { product: true, saleReports: true },
        orderBy: { deliveryDate: 'desc' },
      },
    },
  })

  return partners.map((partner) => {
    const byProduct = new Map<string, { delivered: number; sold: number }>()
    const history: ConsignmentHistoryEvent[] = []

    for (const delivery of partner.deliveries) {
      const entry = byProduct.get(delivery.product.name) ?? { delivered: 0, sold: 0 }
      entry.delivered += delivery.quantityDelivered
      history.push({ date: delivery.deliveryDate, type: 'entrega', productName: delivery.product.name, quantity: delivery.quantityDelivered })
      for (const report of delivery.saleReports) {
        entry.sold += report.quantitySold
        history.push({ date: report.reportDate, type: 'venda', productName: delivery.product.name, quantity: report.quantitySold })
      }
      byProduct.set(delivery.product.name, entry)
    }

    history.sort((a, b) => b.date.getTime() - a.date.getTime())

    return {
      partnerId: partner.id,
      partnerName: partner.name,
      products: [...byProduct.entries()].map(([productName, { delivered, sold }]) => ({
        productName,
        delivered,
        sold,
        remaining: delivered - sold,
      })),
      history,
    }
  })
}

export async function getConsignmentStockSummary() {
  const deliveries = await prisma.consignmentDelivery.findMany({
    include: { partner: true, product: true, saleReports: true },
  })
  return deliveries
    .map((d) => ({
      partnerName: d.partner.name,
      productName: d.product.name,
      remaining: d.quantityDelivered - d.saleReports.reduce((s, r) => s + r.quantitySold, 0),
    }))
    .filter((d) => d.remaining > 0)
}
