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

function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2014')
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

// Physical delete — unlike deletePrinter (soft-delete) above, this actually
// removes the row. Product and ProductionRun reference Printer via FK, so
// deleting a printer that is still in use is rejected by Postgres; catch that
// and point the user at the deactivate/reactivate flow instead of letting a
// raw FK error propagate unhandled to the UI.
export async function deletePrinterPermanently(id: string): Promise<ActionResult> {
  try {
    await prisma.printer.delete({ where: { id } })
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return {
        success: false,
        error: 'Não é possível excluir: esta impressora tem produtos ou produções vinculadas. Desative-a em vez disso.',
      }
    }
    throw err
  }
  revalidatePath('/printers')
  return { success: true }
}
