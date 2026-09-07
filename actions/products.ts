'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/validation/product'
import { calculateProductCost, type ProductCostBreakdown } from '@/lib/costing'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return productSchema.safeParse({
    ...raw,
    packagingItemId: raw.packagingItemId || null,
    accessoryId: raw.accessoryId || null,
  })
}

export async function createProduct(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.product.create({ data: parsed.data })
  revalidatePath('/products')
  return { success: true }
}

export async function updateProduct(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.product.update({ where: { id }, data: parsed.data })
  revalidatePath('/products')
  return { success: true }
}

// Soft-delete: ProductionRun, Sale and ConsignmentDelivery reference Product,
// so a product that has been used in existing runs/sales cannot be physically
// removed.
export async function deleteProduct(id: string): Promise<ActionResult> {
  await prisma.product.update({ where: { id }, data: { active: false } })
  revalidatePath('/products')
  return { success: true }
}

export async function getProductCostBreakdown(productId: string): Promise<ProductCostBreakdown> {
  const [product, settings] = await Promise.all([
    prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: {
        printer: true,
        filament: true,
        packagingItem: true,
        accessory: true,
        supplyUsages: { include: { supply: true } },
      },
    }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])

  const printerDepreciationCostPerHour =
    (product.printer.purchasePrice.toNumber() + product.printer.maintenanceCost.toNumber()) /
    product.printer.depreciationHours.toNumber()

  const suppliesCost = product.supplyUsages.reduce(
    (sum, u) => sum + u.quantity.toNumber() * u.supply.unitCost.toNumber(),
    0,
  )

  return calculateProductCost(
    {
      weightGrams: product.weightGrams.toNumber(),
      printTimeHours: product.printTimeHours.toNumber(),
      laborTimeHours: product.laborTimeHours.toNumber(),
      filamentPricePerKg: product.filament.spoolPrice.toNumber() / product.filament.spoolWeightKg.toNumber(),
      printerAvgPowerConsumptionKwh: product.printer.avgPowerConsumptionKwh.toNumber(),
      printerDepreciationCostPerHour,
      suppliesCost,
      packagingCost: product.packagingItem?.unitCost.toNumber() ?? 0,
      accessoryCost: product.accessory?.unitCost.toNumber() ?? 0,
    },
    {
      energyCostPerKwh: settings.energyCostPerKwh.toNumber(),
      laborCostPerHour: settings.laborCostPerHour.toNumber(),
      failureRatePercent: settings.failureRatePercent.toNumber(),
      marketplaceFeePercent: settings.marketplaceFeePercent.toNumber(),
      taxPercent: settings.taxPercent.toNumber(),
      marketplaceFixedFee: settings.marketplaceFixedFee.toNumber(),
      defaultMarkup: settings.defaultMarkup.toNumber(),
    },
  )
}

const supplyUsageSchema = z.object({
  productId: z.string().min(1),
  supplyId: z.string().min(1),
  quantity: z.coerce.number().positive(),
})

export async function addProductSupplyUsage(formData: FormData): Promise<ActionResult> {
  const parsed = supplyUsageSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.productSupplyUsage.upsert({
    where: { productId_supplyId: { productId: parsed.data.productId, supplyId: parsed.data.supplyId } },
    update: { quantity: parsed.data.quantity },
    create: parsed.data,
  })
  revalidatePath('/products')
  return { success: true }
}

export async function removeProductSupplyUsage(usageId: string): Promise<ActionResult> {
  await prisma.productSupplyUsage.delete({ where: { id: usageId } })
  revalidatePath('/products')
  return { success: true }
}
