'use server'
import { prisma } from '@/lib/prisma'
import { productionRunSchema } from '@/lib/validation/productionRun'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return productionRunSchema.safeParse({
    ...raw,
    notes: raw.notes || null,
  })
}

export async function createProductionRun(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.productionRun.create({ data: parsed.data })
  revalidatePath('/production')
  return { success: true }
}

// Physical delete: ProductionRun is a historical log, not a catalog entity,
// so unlike Printer/Filament/PackagingItem/Accessory/Supply/Product there is
// no soft-delete flag — removing a row (e.g. to fix a typo) really deletes it.
export async function deleteProductionRun(id: string): Promise<ActionResult> {
  await prisma.productionRun.delete({ where: { id } })
  revalidatePath('/production')
  return { success: true }
}
