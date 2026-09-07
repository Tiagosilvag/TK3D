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

// The stock-sufficiency check below (gramsUsed + gramsWasted <= currentStockGrams)
// cannot be expressed in the Zod schema alone because it depends on a database
// read — same reasoning as createConsignmentSaleReport's balance check. The
// create + decrement pair runs in a single $transaction so a run that fails
// never partially applies (row created but stock unchanged, or vice versa).
export async function createProductionRun(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const totalConsumed = parsed.data.gramsUsed + parsed.data.gramsWasted
  const filament = await prisma.filament.findUniqueOrThrow({ where: { id: parsed.data.filamentId } })
  const currentStock = filament.currentStockGrams.toNumber()
  if (totalConsumed > currentStock) {
    return { success: false, error: `Quantidade excede o estoque disponível (${currentStock}g)` }
  }

  await prisma.$transaction([
    prisma.productionRun.create({ data: parsed.data }),
    prisma.filament.update({
      where: { id: parsed.data.filamentId },
      data: { currentStockGrams: { decrement: totalConsumed } },
    }),
  ])

  revalidatePath('/production')
  revalidatePath('/filaments')
  return { success: true }
}

// Physical delete: ProductionRun is a historical log, not a catalog entity,
// so unlike Printer/Filament/PackagingItem/Accessory/Supply/Product there is
// no soft-delete flag — removing a row (e.g. to fix a typo) really deletes it.
//
// createProductionRun decrements Filament.currentStockGrams by
// gramsUsed + gramsWasted when the run is recorded. Deleting a run is the
// documented way to correct a mistake (e.g. wrong data entry), so it must
// reverse that decrement — otherwise using the documented correction path
// permanently and silently understates stock, with no way to fix it short of
// a direct DB edit. Read the run's consumption before deleting it, then
// delete + restore the stock in the same $transaction (same atomicity
// pattern as createProductionRun) so a failure never partially applies.
export async function deleteProductionRun(id: string): Promise<ActionResult> {
  const run = await prisma.productionRun.findUniqueOrThrow({ where: { id } })
  const totalConsumed = run.gramsUsed.plus(run.gramsWasted)

  await prisma.$transaction([
    prisma.productionRun.delete({ where: { id } }),
    prisma.filament.update({
      where: { id: run.filamentId },
      data: { currentStockGrams: { increment: totalConsumed } },
    }),
  ])

  revalidatePath('/production')
  revalidatePath('/filaments')
  return { success: true }
}
