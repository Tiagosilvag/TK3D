'use server'
import { prisma } from '@/lib/prisma'
import { consignmentPartnerSchema } from '@/lib/validation/consignment'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return consignmentPartnerSchema.safeParse({
    ...raw,
    notes: raw.notes || null,
  })
}

export async function createConsignmentPartner(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.consignmentPartner.create({ data: parsed.data })
  revalidatePath('/consignment/partners')
  return { success: true }
}

export async function updateConsignmentPartner(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.consignmentPartner.update({ where: { id }, data: parsed.data })
  revalidatePath('/consignment/partners')
  return { success: true }
}

// Soft-delete: ConsignmentDelivery references ConsignmentPartner, so a
// partner that already has deliveries cannot be physically removed.
export async function deleteConsignmentPartner(id: string): Promise<ActionResult> {
  await prisma.consignmentPartner.update({ where: { id }, data: { active: false } })
  revalidatePath('/consignment/partners')
  return { success: true }
}
