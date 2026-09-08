'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/validation/product'
import { calculateProductCost, calculatePrinterDepreciationCostPerHour, calculatePrinterMaintenanceCostPerHour, calculateFilamentPricePerKg, sumUsageCost, applyRounding, type ProductCostBreakdown } from '@/lib/costing'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return productSchema.safeParse({
    ...raw,
    packagingItemId: raw.packagingItemId || null,
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
        accessoryUsages: { include: { accessory: true } },
        supplyUsages: { include: { supply: true } },
      },
    }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])

  const printerDepreciationCostPerHour = calculatePrinterDepreciationCostPerHour({
    purchasePrice: product.printer.purchasePrice.toNumber(),
    depreciationHours: product.printer.depreciationHours.toNumber(),
  })

  const printerMaintenanceCostPerHour = calculatePrinterMaintenanceCostPerHour({
    purchasePrice: product.printer.purchasePrice.toNumber(),
    annualMaintenancePercent: settings.annualMaintenancePercent.toNumber(),
    annualUsageHours: settings.annualUsageHours.toNumber(),
  })

  const filamentPricePerKg = calculateFilamentPricePerKg({
    spoolPrice: product.filament.spoolPrice.toNumber(),
    spoolWeightKg: product.filament.spoolWeightKg.toNumber(),
  })

  const suppliesCost = sumUsageCost(
    product.supplyUsages.map((u) => ({ quantity: u.quantity.toNumber(), avgUnitCost: u.supply.avgUnitCost.toNumber() })),
  )
  // Ficha técnica §2 (task-5 brief): accessoryId's single-FK is now a list
  // (ProductAccessoryUsage), same shape/reduction as suppliesCost above —
  // sum quantity * avgUnitCost across every accessory row on this product.
  const accessoriesCost = sumUsageCost(
    product.accessoryUsages.map((u) => ({ quantity: u.quantity.toNumber(), avgUnitCost: u.accessory.avgUnitCost.toNumber() })),
  )

  return calculateProductCost(
    {
      weightGrams: product.weightGrams.toNumber(),
      printTimeHours: product.printTimeHours.toNumber(),
      laborTimeHours: product.laborTimeHours.toNumber(),
      filamentPricePerKg,
      printerAvgPowerConsumptionKwh: product.printer.avgPowerConsumptionKwh.toNumber(),
      printerDepreciationCostPerHour,
      printerMaintenanceCostPerHour,
      suppliesCost,
      packagingCost: product.packagingItem?.unitCost.toNumber() ?? 0,
      accessoryCost: accessoriesCost,
      includeDepreciation: settings.includeDepreciation,
      includeEnergyCost: settings.includeEnergyCost,
      includeMaintenance: settings.includeMaintenance,
      includeLaborCost: settings.includeLaborCost,
      includeFailureRate: settings.includeFailureRate,
      includeFilamentCost: settings.includeFilamentCost,
      includeAccessoriesCost: settings.includeAccessoriesCost,
      includeSuppliesCost: settings.includeSuppliesCost,
      includePackagingCost: settings.includePackagingCost,
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

// Bug 3: auto-preenchimento do formulário de Produção ao selecionar um
// produto -- devolve os dados da ficha técnica que o form de produção
// consegue mapear (impressora/filamento, e peso×qtd como sugestão de
// "Filamento usado (g)"). printTimeHours vai junto só como referência
// informativa: ProductionRun não tem um campo de tempo de impressão
// próprio (só timeWastedHours, que é sobre desperdício), então a tela usa
// esse valor pra mostrar "tempo esperado" ao lado da quantidade planejada,
// sem inventar uma coluna nova no schema pra isso.
export interface ProductProductionDefaults {
  printerId: string
  filamentId: string
  weightGrams: number
  printTimeHours: number
}

export async function getProductProductionDefaults(productId: string): Promise<ProductProductionDefaults> {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
  return {
    printerId: product.printerId,
    filamentId: product.filamentId,
    weightGrams: product.weightGrams.toNumber(),
    printTimeHours: product.printTimeHours.toNumber(),
  }
}

function filamentOptionLabel(f: {
  manufacturer: string
  colorName: string
  material: string
  rollNumber: number
}): string {
  return `${f.manufacturer} ${f.colorName} (${f.material}) — Rolo #${String(f.rollNumber).padStart(3, '0')}`
}

// Filament options for the product edit form's dropdown. Filtered to in-stock
// rolls (currentStockGrams > 0), which is correct for picking a NEW filament
// -- BUT if the product's *current* filament has since depleted to 0, it
// won't be in that in-stock list. A plain
// <select defaultValue={product.filamentId}> whose defaultValue matches no
// <option> makes the browser silently fall back to selecting the FIRST
// option, so simply saving the form (with no changes intended) would
// silently reassign the product to a random filament. To force an explicit,
// informed choice instead, the depleted current filament (if any) is looked
// up separately and returned as a clearly-labeled "(esgotado)" option, so
// defaultValue always matches a real <option> and the user must actively
// choose to keep it or pick a replacement roll.
export async function getEditableFilamentOptions(productId: string): Promise<{ id: string; name: string; pricePerGram: number }[]> {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
  const inStock = await prisma.filament.findMany({
    where: { currentStockGrams: { gt: 0 } },
    orderBy: { manufacturer: 'asc' },
  })

  const currentInStock = inStock.some((f) => f.id === product.filamentId)
  const depletedCurrent = currentInStock
    ? null
    : await prisma.filament.findUnique({ where: { id: product.filamentId } })

  const priceOf = (f: { spoolPrice: import('@prisma/client').Prisma.Decimal; spoolWeightKg: import('@prisma/client').Prisma.Decimal }) =>
    calculateFilamentPricePerKg({ spoolPrice: f.spoolPrice.toNumber(), spoolWeightKg: f.spoolWeightKg.toNumber() }) / 1000

  return [
    ...(depletedCurrent ? [{ id: depletedCurrent.id, name: `${filamentOptionLabel(depletedCurrent)} (esgotado)`, pricePerGram: priceOf(depletedCurrent) }] : []),
    ...inStock.map((f) => ({ id: f.id, name: filamentOptionLabel(f), pricePerGram: priceOf(f) })),
  ]
}

const supplyUsageSchema = z.object({
  productId: z.string().min(1),
  supplyId: z.string().min(1),
  quantity: z.coerce.number().positive('Quantidade deve ser maior que zero'),
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

// Ficha técnica §2 (task-5 brief): mirrors addProductSupplyUsage/
// removeProductSupplyUsage above exactly -- ProductAccessoryUsage is the
// same "list of product<->resource with quantity" shape that used to be a
// single Product.accessoryId FK. UI for managing this list is Task 6's
// scope; these two actions are the write path the schema change needs to
// be exercisable/testable now.
const accessoryUsageSchema = z.object({
  productId: z.string().min(1),
  accessoryId: z.string().min(1),
  quantity: z.coerce.number().positive('Quantidade deve ser maior que zero'),
})

export async function addProductAccessoryUsage(formData: FormData): Promise<ActionResult> {
  const parsed = accessoryUsageSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.productAccessoryUsage.upsert({
    where: { productId_accessoryId: { productId: parsed.data.productId, accessoryId: parsed.data.accessoryId } },
    update: { quantity: parsed.data.quantity },
    create: parsed.data,
  })
  revalidatePath('/products')
  return { success: true }
}

export async function removeProductAccessoryUsage(usageId: string): Promise<ActionResult> {
  await prisma.productAccessoryUsage.delete({ where: { id: usageId } })
  revalidatePath('/products')
  return { success: true }
}

// Preço §2 (task-6 brief): the ONLY thing that ever writes suggestedPrice/
// marketplacePrice to the DB. The "Simulação de preço" section on the
// product edit page (lib/costing.ts's simulateProductPrice, client-side,
// never persisted) computes candidate values and calls this action only
// when the user explicitly clicks "Aplicar preço calculado" -- this action
// itself has no opinion on how the numbers were derived, it just validates
// and persists whatever it's handed.
const applyPriceSchema = z.object({
  productId: z.string().min(1),
  suggestedPrice: z.coerce.number().nonnegative('Preço sugerido não pode ser negativo'),
  marketplacePrice: z.coerce.number().nonnegative('Preço de marketplace não pode ser negativo'),
})

// Fix 4 (task-10 brief): applyRounding/Settings.roundingMode (lib/costing.ts,
// Task 2) had zero call sites before this -- fully implemented and
// unit-tested, but never wired into anything that persists or displays a
// final price. Applied here to BOTH final prices, exactly once, right
// before persisting -- never to any cost breakdown component (spec §3: "só
// é aplicada ao preço sugerido/marketplace final, nunca aos componentes de
// custo"). PriceSimulation.tsx applies the same function to the live
// preview before this action is ever called, so the value the user sees
// and the value this persists already agree; re-applying it here is a
// no-op on an already-rounded value (applyRounding is idempotent for a
// fixed mode) and is what makes this the single source of truth for what
// actually gets stored, regardless of what a caller passes in.
export async function applyProductPrice(
  productId: string,
  suggestedPrice: number,
  marketplacePrice: number,
): Promise<ActionResult> {
  const parsed = applyPriceSchema.safeParse({ productId, suggestedPrice, marketplacePrice })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  const roundedSuggestedPrice = applyRounding(parsed.data.suggestedPrice, settings.roundingMode)
  const roundedMarketplacePrice = applyRounding(parsed.data.marketplacePrice, settings.roundingMode)

  await prisma.product.update({
    where: { id: parsed.data.productId },
    data: {
      suggestedPrice: roundedSuggestedPrice,
      marketplacePrice: roundedMarketplacePrice,
    },
  })
  revalidatePath('/products')
  return { success: true }
}
