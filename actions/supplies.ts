'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { supplySchema } from '@/lib/validation/supply'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  return supplySchema.safeParse(Object.fromEntries(formData))
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function createSupply(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.supply.create({ data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um insumo com esse nome' }
    throw err
  }
  revalidatePath('/supplies')
  return { success: true }
}

export async function updateSupply(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.supply.update({ where: { id }, data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um insumo com esse nome' }
    throw err
  }
  revalidatePath('/supplies')
  return { success: true }
}

// Soft-delete: ProductSupplyUsage references Supply, so a supply that has
// been used in existing products cannot be physically removed.
export async function deleteSupply(id: string): Promise<ActionResult> {
  await prisma.supply.update({ where: { id }, data: { active: false } })
  revalidatePath('/supplies')
  return { success: true }
}
