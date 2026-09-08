'use server'
import { prisma } from '@/lib/prisma'
import { filamentSchema } from '@/lib/validation/filament'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export async function createFilament(formData: FormData): Promise<ActionResult> {
  const parsed = filamentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const existingCount = await prisma.filament.count({
    where: { manufacturer: parsed.data.manufacturer, material: parsed.data.material, colorName: parsed.data.colorName },
  })
  const initialStockGrams = parsed.data.spoolWeightKg * 1000

  await prisma.filament.create({
    data: {
      ...parsed.data,
      rollNumber: existingCount + 1,
      initialStockGrams,
      currentStockGrams: initialStockGrams,
    },
  })
  revalidatePath('/filaments')
  return { success: true }
}

// Corrects registration data (manufacturer/material/color/spool weight/spool
// price) for an existing roll. Deliberately does NOT touch rollNumber,
// initialStockGrams or currentStockGrams — those track physical stock
// consumption and are unrelated to fixing a data-entry mistake.
export async function updateFilament(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = filamentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.filament.update({ where: { id }, data: parsed.data })
  revalidatePath('/filaments')
  return { success: true }
}

// Physical delete — no soft-delete in this model (spec §3.2). If a Product/ProductionRun
// references this roll, Postgres's FK constraint blocks it and Prisma throws; that
// propagates as an unhandled error, matching the existing precedent elsewhere in this
// codebase of not handling FK-constraint deletes specially.
export async function deleteFilament(id: string): Promise<ActionResult> {
  await prisma.filament.delete({ where: { id } })
  revalidatePath('/filaments')
  return { success: true }
}
