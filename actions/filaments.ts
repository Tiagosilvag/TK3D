'use server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { filamentSchema, filamentPurchaseSchema, filamentUpdateSchema } from '@/lib/validation/filament'
import { calculateWeightedAverageCost } from '@/lib/costing'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003'
}

// Melhoria "Estoque de filamento por custo médio ponderado": cadastro de um
// Filament NOVO = a primeira compra (mesmo padrão de createAccessory) --
// cria a linha do Filament E sua primeira FilamentPurchase na mesma
// transação. currentStockGrams/avgUnitCostPerGram vêm de
// calculateWeightedAverageCost partindo de estoque zerado, o que reduz a
// fórmula a totalCost/weightGrams -- exatamente o "custo unitário" que uma
// primeira compra implica.
export async function createFilament(formData: FormData): Promise<ActionResult> {
  const parsed = filamentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { manufacturer, material, colorName, colorHex, weightKg, totalCost, purchaseDate, notes } = parsed.data
  const weightGrams = weightKg * 1000

  const avgUnitCostPerGram = calculateWeightedAverageCost({
    currentStock: 0,
    avgUnitCost: 0,
    purchaseQuantity: weightGrams,
    purchaseTotalCost: totalCost,
  })

  try {
    await prisma.$transaction(async (tx) => {
      const filament = await tx.filament.create({
        data: { manufacturer, material, colorName, colorHex, currentStockGrams: weightGrams, avgUnitCostPerGram },
      })
      await tx.filamentPurchase.create({
        data: { filamentId: filament.id, weightGrams, totalCost, purchaseDate, notes },
      })
    })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um filamento com essa marca, material e cor -- use "Repor estoque" nele.' }
    throw err
  }
  revalidatePath('/filaments')
  return { success: true }
}

// Corrige marca/material/cor de um Filament já cadastrado -- nunca estoque
// ou custo, que só mudam por uma compra real (createFilament/
// registerFilamentPurchase).
export async function updateFilament(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = filamentUpdateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    await prisma.filament.update({ where: { id }, data: parsed.data })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Já existe um filamento com essa marca, material e cor' }
    throw err
  }
  revalidatePath('/filaments')
  return { success: true }
}

// "Repor estoque": registra uma nova FilamentPurchase pra um Filament já
// existente, recalculando avgUnitCostPerGram como a média ponderada entre o
// que já estava em estoque e esta compra nova, incrementando
// currentStockGrams -- mesmo fluxo de registerAccessoryPurchase.
export async function registerFilamentPurchase(formData: FormData): Promise<ActionResult> {
  const parsed = filamentPurchaseSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { filamentId, weightKg, totalCost, purchaseDate, notes } = parsed.data
  const weightGrams = weightKg * 1000

  await prisma.$transaction(async (tx) => {
    const filament = await tx.filament.findUniqueOrThrow({ where: { id: filamentId } })
    const currentStockGrams = filament.currentStockGrams.toNumber()
    const newAvgUnitCostPerGram = calculateWeightedAverageCost({
      currentStock: currentStockGrams,
      avgUnitCost: filament.avgUnitCostPerGram.toNumber(),
      purchaseQuantity: weightGrams,
      purchaseTotalCost: totalCost,
    })

    await tx.filament.update({
      where: { id: filamentId },
      data: { currentStockGrams: currentStockGrams + weightGrams, avgUnitCostPerGram: newAvgUnitCostPerGram },
    })
    await tx.filamentPurchase.create({
      data: { filamentId, weightGrams, totalCost, purchaseDate, notes },
    })
  })

  revalidatePath('/filaments')
  return { success: true }
}

// Physical delete — bloqueado se esgotado (histórico é mantido
// automaticamente, mesma regra de deleteAccessory) ou se referenciado por
// Product/ProductPart/ProductionRun (FK ON DELETE RESTRICT -- Prisma joga
// P2003, tratado aqui como ActionResult amigável em vez de crashar a
// página).
export async function deleteFilament(id: string): Promise<ActionResult> {
  const filament = await prisma.filament.findUniqueOrThrow({ where: { id } })
  if (filament.currentStockGrams.toNumber() <= 0) {
    return { success: false, error: 'Filamentos esgotados não podem ser excluídos — o histórico é mantido automaticamente.' }
  }
  try {
    await prisma.filament.delete({ where: { id } })
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return { success: false, error: 'Este filamento está sendo usado na ficha técnica ou em produções registradas e não pode ser excluído.' }
    }
    throw err
  }
  revalidatePath('/filaments')
  return { success: true }
}
