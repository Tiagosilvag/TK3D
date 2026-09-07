'use server'
import { prisma } from '@/lib/prisma'
import { saleSchema } from '@/lib/validation/sale'
import { getProductCostBreakdown } from './products'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return saleSchema.safeParse({
    ...raw,
    buyerOrPlatform: raw.buyerOrPlatform || null,
    notes: raw.notes || null,
  })
}

export async function createSale(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.sale.create({ data: parsed.data })
  revalidatePath('/sales')
  return { success: true }
}

// Physical delete: Sale is a historical transaction log, not a catalog
// entity, so unlike Printer/Filament/PackagingItem/Accessory/Supply/Product
// there is no soft-delete flag — removing a row (e.g. to fix a typo) really
// deletes it, matching the ProductionRun/ConsignmentSaleReport precedent.
export async function deleteSale(id: string): Promise<ActionResult> {
  await prisma.sale.delete({ where: { id } })
  revalidatePath('/sales')
  return { success: true }
}

export async function getSaleProfit(saleId: string): Promise<number> {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })
  const breakdown = await getProductCostBreakdown(sale.productId)
  return sale.quantity * (sale.unitPrice.toNumber() - breakdown.finalCost)
}
