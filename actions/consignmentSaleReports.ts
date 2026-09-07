'use server'
import { prisma } from '@/lib/prisma'
import { consignmentSaleReportSchema } from '@/lib/validation/consignment'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

// The balance check below (quantitySold <= remaining) cannot be expressed in
// the Zod schema alone because it depends on a database query — the sum of
// quantitySold already reported against this same delivery. It is validated
// here, after the Zod parse, and before the row is created.
export async function createConsignmentSaleReport(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  const parsed = consignmentSaleReportSchema.safeParse({
    ...raw,
    notes: raw.notes || null,
  })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({
    where: { id: parsed.data.deliveryId },
    include: { saleReports: true },
  })
  const alreadySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
  const remaining = delivery.quantityDelivered - alreadySold
  if (parsed.data.quantitySold > remaining) {
    return { success: false, error: `Quantidade excede o saldo disponível (${remaining})` }
  }

  await prisma.consignmentSaleReport.create({ data: parsed.data })
  revalidatePath('/consignment/reports')
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Historical log like ProductionRun: physical delete only, no active field.
export async function deleteConsignmentSaleReport(id: string): Promise<ActionResult> {
  await prisma.consignmentSaleReport.delete({ where: { id } })
  revalidatePath('/consignment/reports')
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

export async function getPartnerStock(partnerId: string) {
  const deliveries = await prisma.consignmentDelivery.findMany({
    where: { partnerId },
    include: { product: true, saleReports: true },
  })
  return deliveries.map((d) => {
    const sold = d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
    return {
      productId: d.productId,
      productName: d.product.name,
      delivered: d.quantityDelivered,
      sold,
      remaining: d.quantityDelivered - sold,
    }
  })
}
