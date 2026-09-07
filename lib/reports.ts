import { prisma } from '@/lib/prisma'
import { calculateWasteCost } from '@/lib/costing'

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
    const printerDepreciationCostPerHour =
      (run.printer.purchasePrice.toNumber() + run.printer.maintenanceCost.toNumber()) /
      run.printer.depreciationHours.toNumber()
    return sum + calculateWasteCost({
      gramsWasted: run.gramsWasted.toNumber(),
      timeWastedHours: run.timeWastedHours.toNumber(),
      filamentPricePerKg: run.filament.spoolPrice.toNumber() / run.filament.spoolWeightKg.toNumber(),
      printerDepreciationCostPerHour,
      printerAvgPowerConsumptionKwh: run.printer.avgPowerConsumptionKwh.toNumber(),
      energyCostPerKwh: settings.energyCostPerKwh.toNumber(),
    })
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
