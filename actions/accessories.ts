'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { accessorySchema, accessoryPurchaseSchema } from '@/lib/validation/accessory'
import { calculateWeightedAverageCost } from '@/lib/costing'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// Cadastro de um Accessory NOVO = a primeira compra (task-3 brief): creates
// the Accessory row AND its first AccessoryPurchase in the same transaction.
// currentStock/avgUnitCost are derived from that purchase via
// calculateWeightedAverageCost, starting from a zeroed-out stock (0
// currentStock, 0 avgUnitCost) -- which collapses the formula down to plain
// totalCost/quantity, exactly the "custo unitário" a first purchase implies.
export async function createAccessory(formData: FormData): Promise<ActionResult> {
  const parsed = accessorySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { name, type, colorName, colorHex, quantity, totalCost, purchaseDate, notes } = parsed.data

  const avgUnitCost = calculateWeightedAverageCost({
    currentStock: 0,
    avgUnitCost: 0,
    purchaseQuantity: quantity,
    purchaseTotalCost: totalCost,
  })

  try {
    await prisma.$transaction(async (tx) => {
      const accessory = await tx.accessory.create({
        data: { name, type, colorName, colorHex, currentStock: quantity, avgUnitCost },
      })
      await tx.accessoryPurchase.create({
        data: { accessoryId: accessory.id, quantity, totalCost, purchaseDate, notes },
      })
    })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um acessório com esse nome, tipo e cor' }
    throw err
  }
  revalidatePath('/accessories')
  return { success: true }
}

// "Repor estoque" (task-3 brief): registers a new AccessoryPurchase for an
// existing Accessory, recalculating avgUnitCost as the weighted average of
// what was already in stock and this new purchase, then incrementing
// currentStock. There is no decrement path anywhere in this file --
// consumption is Task 6's job -- so currentStock here only ever grows.
export async function registerAccessoryPurchase(formData: FormData): Promise<ActionResult> {
  const parsed = accessoryPurchaseSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { accessoryId, quantity, totalCost, purchaseDate, notes } = parsed.data

  await prisma.$transaction(async (tx) => {
    const accessory = await tx.accessory.findUniqueOrThrow({ where: { id: accessoryId } })
    const currentStock = accessory.currentStock.toNumber()
    const newAvgUnitCost = calculateWeightedAverageCost({
      currentStock,
      avgUnitCost: accessory.avgUnitCost.toNumber(),
      purchaseQuantity: quantity,
      purchaseTotalCost: totalCost,
    })

    await tx.accessory.update({
      where: { id: accessoryId },
      data: { currentStock: currentStock + quantity, avgUnitCost: newAvgUnitCost },
    })
    await tx.accessoryPurchase.create({
      data: { accessoryId, quantity, totalCost, purchaseDate, notes },
    })
  })

  revalidatePath('/accessories')
  return { success: true }
}

// Physical delete — only allowed when nothing references this accessory.
// AccessoryPurchase rows cascade automatically (they only exist to explain
// this accessory's own history); a Product still pointing at it via
// accessoryId hits Postgres's FK constraint and Prisma throws, which
// propagates unhandled — same precedent as deleteFilament.
export async function deleteAccessory(id: string): Promise<ActionResult> {
  await prisma.accessory.delete({ where: { id } })
  revalidatePath('/accessories')
  return { success: true }
}
