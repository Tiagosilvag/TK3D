'use server'
import { prisma } from '@/lib/prisma'
import { stockAdjustmentSchema } from '@/lib/validation/stockAdjustment'
import { getOwnStockSummary } from '@/lib/reports'
import { revalidatePath } from 'next/cache'
import type { StockAdjustmentResourceType } from '@prisma/client'

type ActionResult = { success: boolean; error?: string }

// 2.6: Filament/Accessory/Supply têm um contador físico de estoque -- o
// ajuste ESCREVE nele direto. Product não tem (estoque é sempre derivado,
// lib/reports.ts#getOwnStockSummary); pra ele, "quantidade atual" é
// calculada na hora e o ajuste só grava a diferença resultante, sem
// escrever em lugar nenhum.
async function getCurrentQuantity(resourceType: StockAdjustmentResourceType, resourceId: string): Promise<number> {
  switch (resourceType) {
    case 'FILAMENT': {
      const f = await prisma.filament.findUniqueOrThrow({ where: { id: resourceId } })
      return f.currentStockGrams.toNumber()
    }
    case 'ACCESSORY': {
      const a = await prisma.accessory.findUniqueOrThrow({ where: { id: resourceId } })
      return a.currentStock.toNumber()
    }
    case 'SUPPLY': {
      const s = await prisma.supply.findUniqueOrThrow({ where: { id: resourceId } })
      return s.currentStock.toNumber()
    }
    case 'PRODUCT': {
      const rows = await getOwnStockSummary()
      return rows.find((r) => r.productId === resourceId)?.available ?? 0
    }
    case 'PACKAGING': {
      const p = await prisma.packagingItem.findUniqueOrThrow({ where: { id: resourceId } })
      return p.currentStock.toNumber()
    }
  }
}

export async function adjustStock(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  const parsed = stockAdjustmentSchema.safeParse({ ...raw, reasonNote: raw.reasonNote || null })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { resourceType, resourceId, newQty, reason, reasonNote } = parsed.data

  const previousQty = await getCurrentQuantity(resourceType, resourceId)
  const difference = newQty - previousQty

  await prisma.$transaction(async (tx) => {
    if (resourceType === 'FILAMENT') {
      await tx.filament.update({ where: { id: resourceId }, data: { currentStockGrams: newQty } })
    } else if (resourceType === 'ACCESSORY') {
      await tx.accessory.update({ where: { id: resourceId }, data: { currentStock: newQty } })
    } else if (resourceType === 'SUPPLY') {
      await tx.supply.update({ where: { id: resourceId }, data: { currentStock: newQty } })
    } else if (resourceType === 'PACKAGING') {
      await tx.packagingItem.update({ where: { id: resourceId }, data: { currentStock: newQty } })
    }
    // PRODUCT: nada pra escrever -- o "difference" gravado abaixo já é
    // suficiente pra getOwnStockSummary somar na próxima leitura.
    await tx.stockAdjustment.create({
      data: { resourceType, resourceId, previousQty, newQty, difference, reason, reasonNote },
    })
  })

  revalidatePath('/filaments')
  revalidatePath('/accessories')
  revalidatePath('/supplies')
  revalidatePath('/packaging')
  revalidatePath('/stock')
  return { success: true }
}

export interface StockAdjustmentHistoryRow {
  id: string
  previousQty: number
  newQty: number
  difference: number
  reason: string
  reasonNote: string | null
  createdAt: Date
}

export async function getStockAdjustmentHistory(
  resourceType: StockAdjustmentResourceType,
  resourceId: string,
): Promise<StockAdjustmentHistoryRow[]> {
  const rows = await prisma.stockAdjustment.findMany({
    where: { resourceType, resourceId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((r) => ({
    id: r.id,
    previousQty: r.previousQty.toNumber(),
    newQty: r.newQty.toNumber(),
    difference: r.difference.toNumber(),
    reason: r.reason,
    reasonNote: r.reasonNote,
    createdAt: r.createdAt,
  }))
}
