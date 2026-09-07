'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { filamentSchema } from '@/lib/validation/filament'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  return filamentSchema.safeParse(Object.fromEntries(formData))
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function createFilament(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.filament.create({ data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um filamento com esse fabricante' }
    throw err
  }
  revalidatePath('/filaments')
  return { success: true }
}

export async function updateFilament(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.filament.update({ where: { id }, data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um filamento com esse fabricante' }
    throw err
  }
  revalidatePath('/filaments')
  return { success: true }
}

// Soft-delete: Product and ProductionRun reference Filament, so a filament that
// has been used in existing products/runs cannot be physically removed.
export async function deleteFilament(id: string): Promise<ActionResult> {
  await prisma.filament.update({ where: { id }, data: { active: false } })
  revalidatePath('/filaments')
  return { success: true }
}
