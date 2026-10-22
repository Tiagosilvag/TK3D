'use server'
import { randomUUID } from 'crypto'
import type { Prisma, SaleChannel } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getProductCostBreakdown } from './products'
import { resolveSalePlatformFee } from './marketplacePlatforms'
import { getProductVariantStockOptions } from '@/lib/reports'
import { calculateSale, productionCostExPackaging } from '@/lib/saleModal'
import { consumePackagingLines, type PackagingLineInput } from '@/lib/salePackaging'
import type { SaleCostSnapshot } from '@/lib/costing'

// Venda feita pelo modal "Nova venda": 1 produto, embalagem escolhida PRA ESTA
// venda, taxa automática ou manual, frete e brinde. O custo e o lucro saem da
// mesma conta (lib/saleModal#calculateSale) que o modal mostra antes de
// registrar. Tudo é gravado pra editar/desfazer sem mudar o passado.

export interface SaleModalInput {
  channel: 'DIRETA' | 'SHOPEE' | 'MERCADO_LIVRE'
  saleDate: string // yyyy-mm-dd
  buyer: string | null
  notes: string | null
  productId: string
  colorComboKey: string | null
  quantity: number
  unitPrice: number
  freight: number
  // null = taxa automática do canal; número = taxa total digitada à mão.
  platformFeeTotal: number | null
  // Só Mercado Livre: tabela de taxa (null = a do anúncio cadastrado, senão Clássico).
  listingType?: 'CLASSICO' | 'PREMIUM' | null
  packaging: PackagingLineInput[]
  gift: { productId: string; quantity: number; unitCost: number } | null
}

type SaleModalResult = { success: boolean; error?: string; saleId?: string; profit?: number; revenue?: number }

const CHANNELS: SaleChannel[] = ['DIRETA', 'SHOPEE', 'MERCADO_LIVRE']

function refresh() {
  revalidatePath('/sales')
  revalidatePath('/packaging')
  revalidatePath('/stock')
  revalidatePath('/dashboard')
}

function validate(input: SaleModalInput): string | null {
  if (!CHANNELS.includes(input.channel)) return 'Escolha a plataforma.'
  if (!input.productId) return 'Escolha o produto.'
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return 'A quantidade deve ser um número inteiro maior que zero.'
  if (!(input.unitPrice > 0)) return 'Informe o valor unitário.'
  if (!(input.freight >= 0)) return 'O frete não pode ser negativo.'
  if (input.platformFeeTotal !== null && !(input.platformFeeTotal >= 0)) return 'A taxa não pode ser negativa.'
  if (Number.isNaN(new Date(`${input.saleDate}T12:00:00`).getTime())) return 'Data inválida.'
  if (input.packaging.some((l) => !l.packagingItemId || !(l.quantityPerUnit > 0))) return 'Confira a embalagem: escolha o tipo e a quantidade por unidade.'
  if (input.gift && (!input.gift.productId || !(input.gift.quantity > 0) || !(input.gift.unitCost >= 0))) return 'Confira o brinde.'
  return null
}

// Estoque da variação é OBRIGATÓRIO: nunca vende mais do que o estoque montado
// dela (ao editar, a própria venda antiga já está descontada de `available`).
async function checkVariantStock(productId: string, colorComboKey: string | null, quantity: number, alreadyInThisSale: number): Promise<string | null> {
  if (!colorComboKey) return null
  const info = (await getProductVariantStockOptions()).find((p) => p.productId === productId)
  const variant = info?.variants.find((v) => v.key === colorComboKey)
  if (!variant) return null
  const allowed = variant.available + alreadyInThisSale
  if (quantity > allowed) return `Só há ${allowed} em estoque dessa variação (faltam ${quantity - allowed}).`
  return null
}

async function buildSnapshot(input: SaleModalInput): Promise<{ snapshot: SaleCostSnapshot; profit: number; revenue: number }> {
  const [breakdown, settings, packagingItems] = await Promise.all([
    getProductCostBreakdown(input.productId),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.packagingItem.findMany({ where: { id: { in: input.packaging.map((l) => l.packagingItemId) } } }),
  ])
  const productionCostPerUnit = productionCostExPackaging(breakdown, {
    includePackagingCost: settings.includePackagingCost,
    includeFailureRate: settings.includeFailureRate,
    failureRatePercent: settings.failureRatePercent.toNumber(),
  })
  const itemById = new Map(packagingItems.map((p) => [p.id, p]))
  const lines = input.packaging.map((l) => {
    const item = itemById.get(l.packagingItemId)
    return { packagingItemId: l.packagingItemId, name: item?.name ?? '—', quantityPerUnit: l.quantityPerUnit, unitCost: item?.avgUnitCost.toNumber() ?? 0 }
  })
  const packagingTotal = lines.reduce((sum, l) => sum + l.quantityPerUnit * input.quantity * l.unitCost, 0)

  let platformFee: SaleCostSnapshot['platformFee']
  if (input.platformFeeTotal !== null) {
    platformFee = { feePercent: 0, feeFixed: 0, amountTotal: input.platformFeeTotal, manual: true }
  } else {
    const auto = await resolveSalePlatformFee(input.channel, input.unitPrice, input.productId, input.channel === 'MERCADO_LIVRE' ? input.listingType : null)
    if (auto) platformFee = { feePercent: auto.feePercent, feeFixed: auto.feeFixed, amountTotal: auto.feeAmountPerUnit * input.quantity, ...(input.channel === 'MERCADO_LIVRE' && input.listingType ? { listingType: input.listingType } : {}) }
  }

  const snapshot: SaleCostSnapshot = {
    quantity: input.quantity,
    unitCost: breakdown,
    total: productionCostPerUnit * input.quantity + packagingTotal,
    productionCostPerUnit,
    packaging: { lines, total: packagingTotal },
    ...(platformFee ? { platformFee } : {}),
  }
  const calc = calculateSale({
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    productionCostPerUnit,
    packagingLines: lines,
    feeTotal: platformFee?.amountTotal ?? 0,
    freight: input.freight,
    gift: input.gift,
  })
  return { snapshot, profit: calc.profit, revenue: calc.revenue }
}

async function writeBatchExtras(tx: Prisma.TransactionClient, batchId: string, input: SaleModalInput) {
  if (input.gift) await tx.saleGiftUsage.create({ data: { batchId, productId: input.gift.productId, quantity: input.gift.quantity, unitCost: input.gift.unitCost } })
  if (input.freight > 0) await tx.saleFreight.create({ data: { batchId, amount: input.freight } })
}

export async function createSaleFromModal(input: SaleModalInput): Promise<SaleModalResult> {
  const invalid = validate(input)
  if (invalid) return { success: false, error: invalid }
  const stockError = await checkVariantStock(input.productId, input.colorComboKey, input.quantity, 0)
  if (stockError) return { success: false, error: stockError }

  const { snapshot, profit, revenue } = await buildSnapshot(input)
  const batchId = randomUUID()
  const sale = await prisma.$transaction(async (tx) => {
    const created = await tx.sale.create({
      data: {
        channel: input.channel,
        productId: input.productId,
        colorComboKey: input.colorComboKey,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        saleDate: new Date(`${input.saleDate}T12:00:00`),
        buyerOrPlatform: input.buyer || null,
        notes: input.notes || null,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        batchId,
      },
    })
    await consumePackagingLines(tx, created.id, input.productId, input.packaging, input.quantity)
    await writeBatchExtras(tx, batchId, input)
    return created
  })
  refresh()
  return { success: true, saleId: sale.id, profit, revenue }
}

export async function updateSaleFromModal(id: string, input: SaleModalInput): Promise<SaleModalResult> {
  const invalid = validate(input)
  if (invalid) return { success: false, error: invalid }
  const existing = await prisma.sale.findUnique({ where: { id } })
  if (!existing) return { success: false, error: 'Venda não encontrada.' }
  const sameVariant = existing.productId === input.productId && (existing.colorComboKey ?? null) === input.colorComboKey
  const stockError = await checkVariantStock(input.productId, input.colorComboKey, input.quantity, sameVariant ? existing.quantity : 0)
  if (stockError) return { success: false, error: `${stockError} Nada foi alterado.` }

  const { snapshot, profit, revenue } = await buildSnapshot(input)
  const otherInBatch = await prisma.sale.count({ where: { batchId: existing.batchId, id: { not: id } } })
  await prisma.$transaction(async (tx) => {
    // Devolve exatamente o que a venda antiga consumiu, e aplica o novo.
    const consumptions = await tx.stockConsumption.findMany({ where: { source: 'SALE', sourceId: id, resourceType: 'PACKAGING' } })
    for (const c of consumptions) await tx.packagingItem.update({ where: { id: c.resourceId }, data: { currentStock: { increment: c.quantity } } })
    await tx.stockConsumption.deleteMany({ where: { source: 'SALE', sourceId: id, resourceType: 'PACKAGING' } })
    await tx.sale.update({
      where: { id },
      data: {
        channel: input.channel,
        productId: input.productId,
        colorComboKey: input.colorComboKey,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        saleDate: new Date(`${input.saleDate}T12:00:00`),
        buyerOrPlatform: input.buyer || null,
        notes: input.notes || null,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    })
    await consumePackagingLines(tx, id, input.productId, input.packaging, input.quantity)
    // Brinde e frete são do LOTE: só reescreve quando esta é a única venda dele.
    if (otherInBatch === 0) {
      await tx.saleGiftUsage.deleteMany({ where: { batchId: existing.batchId } })
      await tx.saleFreight.deleteMany({ where: { batchId: existing.batchId } })
      await writeBatchExtras(tx, existing.batchId, input)
    }
  })
  refresh()
  return { success: true, saleId: id, profit, revenue }
}

// "Desfazer" de uma venda recém-registrada: devolve a embalagem e apaga a venda
// com o brinde e o frete do lote (se era a única venda dele).
export async function undoCreatedSale(saleId: string): Promise<{ success: boolean; error?: string }> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) return { success: false, error: 'Essa venda já foi removida.' }
  const otherInBatch = await prisma.sale.count({ where: { batchId: sale.batchId, id: { not: saleId } } })
  await prisma.$transaction(async (tx) => {
    const consumptions = await tx.stockConsumption.findMany({ where: { source: 'SALE', sourceId: saleId, resourceType: 'PACKAGING' } })
    for (const c of consumptions) await tx.packagingItem.update({ where: { id: c.resourceId }, data: { currentStock: { increment: c.quantity } } })
    await tx.stockConsumption.deleteMany({ where: { source: 'SALE', sourceId: saleId, resourceType: 'PACKAGING' } })
    if (otherInBatch === 0) {
      await tx.saleGiftUsage.deleteMany({ where: { batchId: sale.batchId } })
      await tx.saleFreight.deleteMany({ where: { batchId: sale.batchId } })
    }
    await tx.sale.delete({ where: { id: saleId } })
  })
  refresh()
  return { success: true }
}

// A venda no formato do modal (pra Editar e "↻ Repetir"). `latest` busca a
// última venda registrada.
export async function getSaleModalInput(saleId: string | 'latest'): Promise<SaleModalInput | null> {
  const sale = saleId === 'latest' ? await prisma.sale.findFirst({ orderBy: { createdAt: 'desc' } }) : await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) return null
  const snapshot = sale.costSnapshot as unknown as SaleCostSnapshot | null
  const [gift, freight] = await Promise.all([
    prisma.saleGiftUsage.findUnique({ where: { batchId: sale.batchId } }),
    prisma.saleFreight.findUnique({ where: { batchId: sale.batchId } }),
  ])
  // Venda anterior ao modal: a embalagem vinha da ficha do produto.
  const legacy = snapshot?.packaging
    ? snapshot.packaging.lines.map((l) => ({ packagingItemId: l.packagingItemId, quantityPerUnit: l.quantityPerUnit }))
    : (await prisma.productPackagingUsage.findMany({ where: { productId: sale.productId } })).map((u) => ({ packagingItemId: u.packagingItemId, quantityPerUnit: u.quantity.toNumber() }))
  return {
    channel: (CHANNELS.includes(sale.channel) ? sale.channel : 'DIRETA') as SaleModalInput['channel'],
    saleDate: sale.saleDate.toISOString().slice(0, 10),
    buyer: sale.buyerOrPlatform,
    notes: sale.notes,
    productId: sale.productId,
    colorComboKey: sale.colorComboKey,
    quantity: sale.quantity,
    unitPrice: sale.unitPrice.toNumber(),
    freight: freight?.amount.toNumber() ?? 0,
    platformFeeTotal: snapshot?.platformFee?.manual ? snapshot.platformFee.amountTotal : null,
    listingType: snapshot?.platformFee?.listingType ?? null,
    packaging: legacy,
    gift: gift ? { productId: gift.productId, quantity: gift.quantity, unitCost: gift.unitCost.toNumber() } : null,
  }
}
