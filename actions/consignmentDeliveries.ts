'use server'
import { prisma } from '@/lib/prisma'
import { consignmentDeliverySchema } from '@/lib/validation/consignment'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return consignmentDeliverySchema.safeParse({
    ...raw,
    notes: raw.notes || null,
  })
}

export async function createConsignmentDelivery(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.consignmentDelivery.create({ data: parsed.data })
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// ConsignmentDelivery has no soft-delete flag (it's not a catalog entity like
// Partner/Product/Printer/Filament). A delivery with no sale reports yet can
// be removed physically to fix a mistake; one that already has sale reports
// against it must be kept so that history stays consistent — deleting it
// would silently break the remaining-balance math for those reports.
export async function deleteConsignmentDelivery(id: string): Promise<ActionResult> {
  const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({
    where: { id },
    include: { saleReports: true },
  })
  if (delivery.saleReports.length > 0) {
    return { success: false, error: 'Não é possível remover uma entrega que já tem relatórios de venda' }
  }
  await prisma.consignmentDelivery.delete({ where: { id } })
  revalidatePath('/consignment/deliveries')
  return { success: true }
}
