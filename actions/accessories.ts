'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { accessorySchema, accessoryPurchaseSchema, accessoryMultiColorSchema, accessoryUpdateSchema } from '@/lib/validation/accessory'
import { calculateWeightedAverageCost } from '@/lib/costing'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003'
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

// Cadastro com múltiplas variações de cor na mesma compra (spec do módulo
// Acessórios): valor total dividido igualmente pelo total de peças de TODAS
// as cores -- um único preço unitário médio, aplicado a cada linha. Cada
// linha upserta sua própria Accessory (name+type+colorName) exatamente como
// createAccessory (linha nova) ou registerAccessoryPurchase (linha já
// existente, mesma média ponderada) faria isoladamente -- feito aqui numa
// única transação pra não deixar cor nenhuma pela metade se alguma falhar.
export async function createAccessoryMultiColor(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  let colors: unknown
  try {
    colors = JSON.parse(String(raw.colorsJson ?? '[]'))
  } catch {
    return { success: false, error: 'Cores inválidas' }
  }
  const parsed = accessoryMultiColorSchema.safeParse({ ...raw, colors })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { name, type, totalCost, purchaseDate, notes, colors: colorRows } = parsed.data

  const totalQuantity = colorRows.reduce((sum, c) => sum + c.quantity, 0)
  const unitCost = totalCost / totalQuantity

  try {
    await prisma.$transaction(async (tx) => {
      for (const color of colorRows) {
        const purchaseCostForColor = color.quantity * unitCost
        const existing = await tx.accessory.findUnique({
          where: { name_type_colorName: { name, type, colorName: color.colorName } },
        })
        if (existing) {
          const currentStock = existing.currentStock.toNumber()
          const newAvgUnitCost = calculateWeightedAverageCost({
            currentStock,
            avgUnitCost: existing.avgUnitCost.toNumber(),
            purchaseQuantity: color.quantity,
            purchaseTotalCost: purchaseCostForColor,
          })
          await tx.accessory.update({
            where: { id: existing.id },
            data: { currentStock: currentStock + color.quantity, avgUnitCost: newAvgUnitCost, colorHex: color.colorHex },
          })
          await tx.accessoryPurchase.create({
            data: { accessoryId: existing.id, quantity: color.quantity, totalCost: purchaseCostForColor, purchaseDate, notes },
          })
        } else {
          const accessory = await tx.accessory.create({
            data: {
              name,
              type,
              colorName: color.colorName,
              colorHex: color.colorHex,
              currentStock: color.quantity,
              avgUnitCost: unitCost,
            },
          })
          await tx.accessoryPurchase.create({
            data: { accessoryId: accessory.id, quantity: color.quantity, totalCost: purchaseCostForColor, purchaseDate, notes },
          })
        }
      }
    })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um acessório com esse nome, tipo e cor' }
    throw err
  }
  revalidatePath('/accessories')
  return { success: true }
}

// Corrige nome/tipo/cor de um Accessory já cadastrado -- nunca estoque ou
// custo, que só mudam por uma compra real (createAccessory/
// registerAccessoryPurchase/createAccessoryMultiColor).
export async function updateAccessory(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = accessoryUpdateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.accessory.update({ where: { id }, data: parsed.data })
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

// Physical delete — only allowed when nothing references this accessory AND
// it isn't depleted. "Esgotados não podem ser excluídos" is an explicit rule
// from the original spec/prompt (spec §1.1: esgotado "some da lista
// principal ... histórico de compras preservado", never deleted).
// AccessoryPurchase rows cascade automatically (they only exist to explain
// this accessory's own history); a Product still pointing at it via
// ProductAccessoryUsage hits Postgres's FK constraint (ON DELETE RESTRICT) --
// Prisma throws P2003, caught below and turned into a friendly ActionResult
// instead of crashing the page (bug: this used to propagate unhandled,
// showing the user a raw "Application error").
export async function deleteAccessory(id: string): Promise<ActionResult> {
  const accessory = await prisma.accessory.findUniqueOrThrow({ where: { id } })
  if (accessory.currentStock.toNumber() <= 0) {
    return { success: false, error: 'Itens esgotados não podem ser excluídos — o histórico é mantido automaticamente.' }
  }
  try {
    await prisma.accessory.delete({ where: { id } })
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return { success: false, error: 'Este acessório está sendo usado na ficha técnica de algum produto e não pode ser excluído.' }
    }
    throw err
  }
  revalidatePath('/accessories')
  return { success: true }
}
