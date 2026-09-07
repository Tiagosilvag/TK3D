'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { accessorySchema } from '@/lib/validation/accessory'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  return accessorySchema.safeParse(Object.fromEntries(formData))
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function createAccessory(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.accessory.create({ data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um acessório com esse nome' }
    throw err
  }
  revalidatePath('/accessories')
  return { success: true }
}

export async function updateAccessory(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.accessory.update({ where: { id }, data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um acessório com esse nome' }
    throw err
  }
  revalidatePath('/accessories')
  return { success: true }
}

// Soft-delete: Product references Accessory, so an accessory that has been
// used in existing products cannot be physically removed.
export async function deleteAccessory(id: string): Promise<ActionResult> {
  await prisma.accessory.update({ where: { id }, data: { active: false } })
  revalidatePath('/accessories')
  return { success: true }
}

export async function reactivateAccessory(id: string): Promise<ActionResult> {
  await prisma.accessory.update({ where: { id }, data: { active: true } })
  revalidatePath('/accessories')
  return { success: true }
}
