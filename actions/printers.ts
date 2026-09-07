'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { printerSchema } from '@/lib/validation/printer'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  return printerSchema.safeParse(Object.fromEntries(formData))
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function createPrinter(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.printer.create({ data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe uma impressora com esse nome' }
    throw err
  }
  revalidatePath('/printers')
  return { success: true }
}

export async function updatePrinter(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.printer.update({ where: { id }, data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe uma impressora com esse nome' }
    throw err
  }
  revalidatePath('/printers')
  return { success: true }
}

// Soft-delete: Product and ProductionRun reference Printer, so a printer that
// has been used in existing products/runs cannot be physically removed.
export async function deletePrinter(id: string): Promise<ActionResult> {
  await prisma.printer.update({ where: { id }, data: { active: false } })
  revalidatePath('/printers')
  return { success: true }
}

export async function reactivatePrinter(id: string): Promise<ActionResult> {
  await prisma.printer.update({ where: { id }, data: { active: true } })
  revalidatePath('/printers')
  return { success: true }
}
