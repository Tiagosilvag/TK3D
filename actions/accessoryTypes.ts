'use server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

const nameSchema = z.object({ name: z.string().min(1, 'Nome é obrigatório') })

export async function createAccessoryType(formData: FormData): Promise<ActionResult> {
  const parsed = nameSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.accessoryTypeRecord.create({ data: { name: parsed.data.name } })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um tipo com esse nome' }
    throw err
  }
  revalidatePath('/settings/accessory-types')
  return { success: true }
}

export async function renameAccessoryType(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = nameSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.accessoryTypeRecord.update({ where: { id }, data: { name: parsed.data.name } })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um tipo com esse nome' }
    throw err
  }
  revalidatePath('/settings/accessory-types')
  revalidatePath('/accessories')
  return { success: true }
}

// Guard: um tipo em uso (referenciado por ao menos um Accessory) não pode
// ser removido -- excluí-lo quebraria a FK Accessory.type -> accessory_types
// e apagaria a categoria de acessórios já cadastrados sob esse nome.
export async function deleteAccessoryType(id: string): Promise<ActionResult> {
  const inUse = await prisma.accessory.count({ where: { type: id } })
  if (inUse > 0) {
    return { success: false, error: `Este tipo está em uso por ${inUse} acessório(s) e não pode ser removido.` }
  }
  await prisma.accessoryTypeRecord.delete({ where: { id } })
  revalidatePath('/settings/accessory-types')
  return { success: true }
}
