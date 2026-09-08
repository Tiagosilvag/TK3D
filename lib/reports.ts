import { prisma } from '@/lib/prisma'
import { calculateWasteCost, calculatePrinterDepreciationCostPerHour, calculatePrinterMaintenanceCostPerHour, calculateFilamentPricePerKg } from '@/lib/costing'
import type { ProductionCostSnapshot } from '@/lib/costing'
import type { Prisma, ProductionStatus, WasteReason } from '@prisma/client'

export async function getRevenueByChannel(): Promise<Record<'DIRETA' | 'MARKETPLACE', number>> {
  const sales = await prisma.sale.findMany()
  const result: Record<string, number> = { DIRETA: 0, MARKETPLACE: 0 }
  for (const s of sales) {
    result[s.channel] += s.quantity * s.unitPrice.toNumber()
  }
  return result as Record<'DIRETA' | 'MARKETPLACE', number>
}

export async function getTotalWasteCost(): Promise<number> {
  const runs = await prisma.productionRun.findMany({ include: { printer: true, filament: true } })
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return runs.reduce((sum, run) => {
    const printerDepreciationCostPerHour = calculatePrinterDepreciationCostPerHour({
      purchasePrice: run.printer.purchasePrice.toNumber(),
      depreciationHours: run.printer.depreciationHours.toNumber(),
    })
    const printerMaintenanceCostPerHour = calculatePrinterMaintenanceCostPerHour({
      purchasePrice: run.printer.purchasePrice.toNumber(),
      annualMaintenancePercent: settings.annualMaintenancePercent.toNumber(),
      annualUsageHours: settings.annualUsageHours.toNumber(),
    })
    const filamentPricePerKg = calculateFilamentPricePerKg({
      spoolPrice: run.filament.spoolPrice.toNumber(),
      spoolWeightKg: run.filament.spoolWeightKg.toNumber(),
    })
    return sum + calculateWasteCost({
      gramsWasted: run.gramsWasted.toNumber(),
      timeWastedHours: run.timeWastedHours.toNumber(),
      filamentPricePerKg,
      printerDepreciationCostPerHour,
      printerMaintenanceCostPerHour,
      printerAvgPowerConsumptionKwh: run.printer.avgPowerConsumptionKwh.toNumber(),
      energyCostPerKwh: settings.energyCostPerKwh.toNumber(),
    })
  }, 0)
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
    if (snapshot) {
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
    if (snapshot) row.totalCost += snapshot.total
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
