'use server'
import { prisma } from '@/lib/prisma'
import { saleSchema } from '@/lib/validation/sale'
import { getProductCostBreakdown } from './products'
import { buildSaleCostSnapshot, type SaleCostSnapshot } from '@/lib/costing'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return saleSchema.safeParse({
    ...raw,
    buyerOrPlatform: raw.buyerOrPlatform || null,
    notes: raw.notes || null,
  })
}

// Sale cost snapshot (task-10 brief, new feature -- explicit user request
// after the final whole-branch review, mirroring ProductionRun.costSnapshot
// exactly, see lib/costing.ts#buildSaleCostSnapshot and
// actions/productionRuns.ts#createProductionRun for the pattern this
// follows). Computed and stored ONCE here, at creation time, from
// getProductCostBreakdown's then-current Printer/Filament/Accessory/
// Supply/Settings values -- never recalculated afterwards. Unlike
// ProductionRun there's no multi-resource stock to check/decrement for a
// Sale (it doesn't consume inventory, it just records a transaction), so
// this stays a single non-transactional create.
export async function createSale(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const breakdown = await getProductCostBreakdown(parsed.data.productId)
  const snapshot = buildSaleCostSnapshot(breakdown, parsed.data.quantity)

  await prisma.sale.create({
    data: {
      ...parsed.data,
      costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  })
  revalidatePath('/sales')
  return { success: true }
}

// Edits an existing sale (channel/product/quantity/unitPrice/date/buyer/
// notes -- spec do módulo Vendas) and recomputes its costSnapshot the same
// way createSale does, from the (possibly new) product's CURRENT cost
// breakdown -- an edit is a correction to what was actually sold, not a
// historical replay, so its frozen cost basis is refreshed to match.
export async function updateSale(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const breakdown = await getProductCostBreakdown(parsed.data.productId)
  const snapshot = buildSaleCostSnapshot(breakdown, parsed.data.quantity)

  await prisma.sale.update({
    where: { id },
    data: {
      ...parsed.data,
      costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  })
  revalidatePath('/sales')
  return { success: true }
}

// Physical delete: Sale is a historical transaction log, not a catalog
// entity, so unlike Printer/Filament/PackagingItem/Accessory/Supply/Product
// there is no soft-delete flag — removing a row (e.g. to fix a typo) really
// deletes it, matching the ProductionRun/ConsignmentSaleReport precedent.
export async function deleteSale(id: string): Promise<ActionResult> {
  await prisma.sale.delete({ where: { id } })
  revalidatePath('/sales')
  return { success: true }
}

export interface SaleProfit {
  profit: number
  // Valor da venda (quantity * unitPrice) e custo de produção (frozen
  // snapshot.total, ou recomputado ao vivo pra venda legada) -- expostos
  // separadamente pra UI mostrar "Valor da venda - Custo = Lucro" (spec do
  // módulo Vendas), não só o resultado já subtraído.
  saleTotal: number
  costTotal: number
  // true only for a legacy sale created before this column existed (no
  // costSnapshot to read) -- its cost had to be recomputed live from
  // CURRENT Printer/Filament/Accessory/Supply/Settings, so unlike every
  // other sale's profit, this number CAN drift if those change later. The
  // UI surfaces this so it isn't silently indistinguishable from a frozen,
  // guaranteed-stable profit.
  estimated: boolean
}

// Reads sale.costSnapshot.total (frozen at creation time, spec §4's
// historical-cost rule extended here to Sale) instead of recalculating via
// getProductCostBreakdown() live -- same guarantee ProductionRun's
// costSnapshot already provides (Task 7): altering Settings/Printer/
// Filament/Accessory/Supply after the sale was recorded must never change
// its displayed profit. Falls back to the old live-recompute path only for
// a sale that predates this column (costSnapshot null) -- there is no
// historical state to reconstruct a snapshot for it retroactively (never
// invent data, same precedent as every other snapshot field in this app).
export async function getSaleProfit(saleId: string): Promise<SaleProfit> {
  const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })
  const snapshot = sale.costSnapshot as unknown as SaleCostSnapshot | null
  const saleTotal = sale.quantity * sale.unitPrice.toNumber()

  if (snapshot) {
    return { profit: saleTotal - snapshot.total, saleTotal, costTotal: snapshot.total, estimated: false }
  }

  const breakdown = await getProductCostBreakdown(sale.productId)
  const costTotal = sale.quantity * breakdown.finalCost
  return { profit: saleTotal - costTotal, saleTotal, costTotal, estimated: true }
}
