import { prisma } from '@/lib/prisma'

export interface CommissionTotals {
  gross: number
  commission: number
  paid: number
  due: number
}

const cents = (n: number) => Math.round(n * 100) / 100

// Comissão de um parceiro, sempre dos REGISTROS: cada venda com a própria
// comissão % (gravada nela), menos os pagamentos feitos.
export async function getPartnerCommissionTotals(partnerId: string): Promise<CommissionTotals> {
  const [reports, payments] = await Promise.all([
    prisma.consignmentSaleReport.findMany({ where: { delivery: { partnerId } }, include: { delivery: { select: { unitPrice: true } } } }),
    prisma.consignmentPartnerPayment.findMany({ where: { partnerId }, select: { amount: true } }),
  ])
  let gross = 0
  let commission = 0
  for (const r of reports) {
    const value = r.quantitySold * (r.unitPrice ?? r.delivery.unitPrice).toNumber()
    gross += value
    commission += value * r.commissionPercent.toNumber()
  }
  const paid = payments.reduce((sum, p) => sum + p.amount.toNumber(), 0)
  return { gross: cents(gross), commission: cents(commission), paid: cents(paid), due: Math.max(0, cents(commission - paid)) }
}
