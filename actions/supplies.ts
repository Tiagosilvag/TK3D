'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { supplySchema, supplyPurchaseSchema, supplyUpdateSchema } from '@/lib/validation/supply'
import { calculateWeightedAverageCost } from '@/lib/costing'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003'
}

// Cadastro de um Supply NOVO = a primeira compra (task-4 brief, mirroring
// task-3's Accessory): creates the Supply row AND its first SupplyPurchase
// in the same transaction. currentStock/avgUnitCost are derived from that
// purchase via calculateWeightedAverageCost, starting from a zeroed-out
// stock (0 currentStock, 0 avgUnitCost) -- which collapses the formula down
// to plain totalCost/quantity, exactly the "custo unitário" a first
// purchase implies.
export async function createSupply(formData: FormData): Promise<ActionResult> {
  const parsed = supplySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { name, unit, quantity, totalCost, purchaseDate, notes, defaultUsage } = parsed.data

  const avgUnitCost = calculateWeightedAverageCost({
    currentStock: 0,
    avgUnitCost: 0,
    purchaseQuantity: quantity,
    purchaseTotalCost: totalCost,
  })

  try {
    await prisma.$transaction(async (tx) => {
      const supply = await tx.supply.create({
        data: { name, unit, currentStock: quantity, avgUnitCost, defaultUsage },
      })
      await tx.supplyPurchase.create({
        data: { supplyId: supply.id, quantity, totalCost, purchaseDate, notes },
      })
    })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um insumo com esse nome' }
    throw err
  }
  revalidatePath('/supplies')
  return { success: true }
}

// Corrige nome/unidade de um Supply já cadastrado -- nunca estoque ou custo,
// que só mudam por uma compra real (createSupply/registerSupplyPurchase).
export async function updateSupply(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = supplyUpdateSchema.safeParse(Object.fromEntries(formData))
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

// "Repor estoque" (task-4 brief): registers a new SupplyPurchase for an
// existing Supply, recalculating avgUnitCost as the weighted average of
// what was already in stock and this new purchase, then incrementing
// currentStock. There is no decrement path anywhere in this file --
// consumption happens in a later task -- so currentStock here only ever
// grows.
export async function registerSupplyPurchase(formData: FormData): Promise<ActionResult> {
  const parsed = supplyPurchaseSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { supplyId, quantity, totalCost, purchaseDate, notes } = parsed.data

  await prisma.$transaction(async (tx) => {
    const supply = await tx.supply.findUniqueOrThrow({ where: { id: supplyId } })
    const currentStock = supply.currentStock.toNumber()
    const newAvgUnitCost = calculateWeightedAverageCost({
      currentStock,
      avgUnitCost: supply.avgUnitCost.toNumber(),
      purchaseQuantity: quantity,
      purchaseTotalCost: totalCost,
    })

    await tx.supply.update({
      where: { id: supplyId },
      data: { currentStock: currentStock + quantity, avgUnitCost: newAvgUnitCost },
    })
    await tx.supplyPurchase.create({
      data: { supplyId, quantity, totalCost, purchaseDate, notes },
    })
  })

  revalidatePath('/supplies')
  return { success: true }
}

// Physical delete — only allowed when nothing references this supply AND it
// isn't depleted. "Esgotados não podem ser excluídos" is an explicit rule
// from the original spec/prompt (mirrors Accessory's spec §1.3 -- "mesma
// lógica ... mesmo padrão esgotado/histórico"). SupplyPurchase rows cascade
// automatically (they only exist to explain this supply's own history); a
// ProductSupplyUsage still pointing at it hits Postgres's FK constraint
// (ON DELETE RESTRICT) -- Prisma throws P2003, caught below and turned into
// a friendly ActionResult instead of crashing the page (bug: this used to
// propagate unhandled, showing the user a raw "Application error").
export async function deleteSupply(id: string): Promise<ActionResult> {
  const supply = await prisma.supply.findUniqueOrThrow({ where: { id } })
  if (supply.currentStock.toNumber() <= 0) {
    return { success: false, error: 'Itens esgotados não podem ser excluídos — o histórico é mantido automaticamente.' }
  }
  try {
    await prisma.supply.delete({ where: { id } })
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return { success: false, error: 'Este insumo está sendo usado na ficha técnica de algum produto e não pode ser excluído.' }
    }
    throw err
  }
  revalidatePath('/supplies')
  return { success: true }
}
