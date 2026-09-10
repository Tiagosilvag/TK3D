'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { packagingItemSchema, packagingItemUpdateSchema, packagingPurchaseSchema } from '@/lib/validation/packaging'
import { calculateWeightedAverageCost } from '@/lib/costing'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// Cadastro de um PackagingItem NOVO = a primeira compra (mesmo padrão de
// createAccessory/createSupply): cria a linha E sua primeira
// PackagingItemPurchase na mesma transação. currentStock/avgUnitCost vêm
// de calculateWeightedAverageCost a partir de estoque zerado -- colapsa
// pra totalCost/quantity puro, exatamente o "custo unitário" que uma
// primeira compra implica. Sem campo de data no formulário (mockup do
// módulo não pede) -- purchaseDate grava o momento do cadastro.
export async function createPackagingItem(formData: FormData): Promise<ActionResult> {
  const parsed = packagingItemSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { name, quantity, totalCost, minStock } = parsed.data

  const avgUnitCost = calculateWeightedAverageCost({
    currentStock: 0,
    avgUnitCost: 0,
    purchaseQuantity: quantity,
    purchaseTotalCost: totalCost,
  })

  try {
    await prisma.$transaction(async (tx) => {
      const item = await tx.packagingItem.create({
        data: { name, currentStock: quantity, avgUnitCost, minStock },
      })
      await tx.packagingItemPurchase.create({
        data: { packagingItemId: item.id, quantity, totalCost, purchaseDate: new Date() },
      })
    })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe uma embalagem com esse nome' }
    throw err
  }
  revalidatePath('/packaging')
  return { success: true }
}

// Corrige nome/estoque mínimo -- nunca estoque ou custo, que só mudam por
// uma compra real (mesmo contrato de updateAccessory).
export async function updatePackagingItem(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = packagingItemUpdateSchema.safeParse(Object.fromEntries(formData))
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

// "Repor estoque": nova PackagingItemPurchase pra um item já existente,
// recalculando avgUnitCost como média ponderada (mesmo mecanismo de
// registerAccessoryPurchase/registerSupplyPurchase). currentStock só
// cresce aqui -- consumo é feito por createProductionRun/confirmAssembly
// (fora do escopo desta tarefa, que é só cadastro/reposição).
export async function registerPackagingPurchase(formData: FormData): Promise<ActionResult> {
  const parsed = packagingPurchaseSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { packagingItemId, quantity, totalCost } = parsed.data

  await prisma.$transaction(async (tx) => {
    const item = await tx.packagingItem.findUniqueOrThrow({ where: { id: packagingItemId } })
    const currentStock = item.currentStock.toNumber()
    const newAvgUnitCost = calculateWeightedAverageCost({
      currentStock,
      avgUnitCost: item.avgUnitCost.toNumber(),
      purchaseQuantity: quantity,
      purchaseTotalCost: totalCost,
    })

    await tx.packagingItem.update({
      where: { id: packagingItemId },
      data: { currentStock: currentStock + quantity, avgUnitCost: newAvgUnitCost },
    })
    await tx.packagingItemPurchase.create({
      data: { packagingItemId, quantity, totalCost, purchaseDate: new Date() },
    })
  })

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

export async function reactivatePackagingItem(id: string): Promise<ActionResult> {
  await prisma.packagingItem.update({ where: { id }, data: { active: true } })
  revalidatePath('/packaging')
  return { success: true }
}
