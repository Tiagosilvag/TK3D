'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { packagingItemSchema } from '@/lib/validation/packaging'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  return packagingItemSchema.safeParse(Object.fromEntries(formData))
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function createPackagingItem(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.packagingItem.create({ data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe uma embalagem com esse nome' }
    throw err
  }
  revalidatePath('/packaging')
  return { success: true }
}

export async function updatePackagingItem(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.packagingItem.update({ where: { id }, data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe uma embalagem com esse nome' }
    throw err
  }
  revalidatePath('/packaging')
  return { success: true }
}

// Soft-delete: Product references PackagingItem, so a packaging item that has
// been used in existing products cannot be physically removed.
export async function deletePackagingItem(id: string): Promise<ActionResult> {
  await prisma.packagingItem.update({ where: { id }, data: { active: false } })
  revalidatePath('/packaging')
  return { success: true }
}
