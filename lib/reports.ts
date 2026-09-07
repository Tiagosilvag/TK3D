import { prisma } from '@/lib/prisma'
import { calculateWasteCost, calculatePrinterDepreciationCostPerHour, calculateFilamentPricePerKg } from '@/lib/costing'

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
    const filamentPricePerKg = calculateFilamentPricePerKg({
      spoolPrice: run.filament.spoolPrice.toNumber(),
      spoolWeightKg: run.filament.spoolWeightKg.toNumber(),
    })
    return sum + calculateWasteCost({
      gramsWasted: run.gramsWasted.toNumber(),
      timeWastedHours: run.timeWastedHours.toNumber(),
      filamentPricePerKg,
      printerDepreciationCostPerHour,
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
