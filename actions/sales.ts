'use server'
import { prisma } from '@/lib/prisma'
import { saleSchema } from '@/lib/validation/sale'
import { getProductCostBreakdown } from './products'
import { buildSaleCostSnapshot, type SaleCostSnapshot } from '@/lib/costing'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'

type ActionResult = { success: boolean; error?: string }
type TxClient = Prisma.TransactionClient

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return saleSchema.safeParse({
    ...raw,
    buyerOrPlatform: raw.buyerOrPlatform || null,
    notes: raw.notes || null,
  })
}

// Melhoria "Histórico de consumo": embalagem passa a ser consumida NA
// VENDA (decisão explícita -- produto que nunca é vendido não consome a
// embalagem que já entra no custo dele; produção/montagem continuam sem
// mexer em PackagingItem.currentStock). Sem clamp em zero de propósito --
// diferente de Accessory/Supply (que bloqueiam a montagem se faltar
// estoque), aqui deixa currentStock ir negativo em vez de recusar a venda:
// bloquear o registro de uma venda de verdade por falta de caixa/saco de
// embalagem seria muito mais disruptivo que só sinalizar "esgotado"/
// estoque negativo pro usuário repor depois. StockConsumption é a fonte
// de verdade de quanto foi de fato decrementado, pra updateSale/deleteSale
// conseguirem reverter exatamente o que uma venda anterior consumiu.
export async function consumePackagingForSale(tx: TxClient, saleId: string, productId: string, quantity: number): Promise<void> {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { packagingItemId: true } })
  if (!product?.packagingItemId) return
  await tx.packagingItem.update({ where: { id: product.packagingItemId }, data: { currentStock: { decrement: quantity } } })
  await tx.stockConsumption.create({
    data: { resourceType: 'PACKAGING', resourceId: product.packagingItemId, quantity, productId, source: 'SALE', sourceId: saleId },
  })
}

// Reverte exatamente o que consumePackagingForSale gravou pra esta venda
// (usado por updateSale antes de reaplicar com os dados novos, e por
// deleteSale) -- lê de StockConsumption em vez de recalcular a partir do
// produto/quantidade atual da venda, que podem já ter mudado.
async function restorePackagingForSale(tx: TxClient, saleId: string): Promise<void> {
  const consumptions = await tx.stockConsumption.findMany({ where: { source: 'SALE', sourceId: saleId, resourceType: 'PACKAGING' } })
  for (const c of consumptions) {
    await tx.packagingItem.update({ where: { id: c.resourceId }, data: { currentStock: { increment: c.quantity } } })
  }
  await tx.stockConsumption.deleteMany({ where: { source: 'SALE', sourceId: saleId, resourceType: 'PACKAGING' } })
}

// Sale cost snapshot (task-10 brief, new feature -- explicit user request
// after the final whole-branch review, mirroring ProductionRun.costSnapshot
// exactly, see lib/costing.ts#buildSaleCostSnapshot and
// actions/productionRuns.ts#createProductionRun for the pattern this
// follows). Computed and stored ONCE here, at creation time, from
// getProductCostBreakdown's then-current Printer/Filament/Accessory/
// Supply/Settings values -- never recalculated afterwards. Filament/
// Accessory/Supply stock is NOT touched here (already consumed earlier, at
// produção/montagem) -- só embalagem, ver consumePackagingForSale acima.
export async function createSale(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const breakdown = await getProductCostBreakdown(parsed.data.productId)
  const snapshot = buildSaleCostSnapshot(breakdown, parsed.data.quantity)

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        ...parsed.data,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    })
    await consumePackagingForSale(tx, sale.id, parsed.data.productId, parsed.data.quantity)
  })
  revalidatePath('/sales')
  revalidatePath('/packaging')
  return { success: true }
}

// Edits an existing sale (channel/product/quantity/unitPrice/date/buyer/
// notes -- spec do módulo Vendas) and recomputes its costSnapshot the same
// way createSale does, from the (possibly new) product's CURRENT cost
// breakdown -- an edit is a correction to what was actually sold, not a
// historical replay, so its frozen cost basis is refreshed to match.
// Mesmo raciocínio pro consumo de embalagem: desfaz o que a venda antiga
// tinha consumido e reaplica com produto/quantidade novos (podem ter
// mudado), nunca os dois somados/divergentes.
export async function updateSale(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const breakdown = await getProductCostBreakdown(parsed.data.productId)
  const snapshot = buildSaleCostSnapshot(breakdown, parsed.data.quantity)

  await prisma.$transaction(async (tx) => {
    await restorePackagingForSale(tx, id)
    await tx.sale.update({
      where: { id },
      data: {
        ...parsed.data,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    })
    await consumePackagingForSale(tx, id, parsed.data.productId, parsed.data.quantity)
  })
  revalidatePath('/sales')
  revalidatePath('/packaging')
  return { success: true }
}

// Physical delete: Sale is a historical transaction log, not a catalog
// entity, so unlike Printer/Filament/PackagingItem/Accessory/Supply/Product
// there is no soft-delete flag — removing a row (e.g. to fix a typo) really
// deletes it, matching the ProductionRun/ConsignmentSaleReport precedent.
// Restaura a embalagem que essa venda tinha consumido antes de apagá-la.
export async function deleteSale(id: string): Promise<ActionResult> {
  await prisma.$transaction(async (tx) => {
    await restorePackagingForSale(tx, id)
    await tx.sale.delete({ where: { id } })
  })
  revalidatePath('/sales')
  revalidatePath('/packaging')
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
