'use server'
import { prisma } from '@/lib/prisma'
import { productionRunSchema, productionRunWasteUpdateSchema } from '@/lib/validation/productionRun'
import {
  buildProductionCostSnapshot,
  calculatePrinterDepreciationCostPerHour,
  calculatePrinterMaintenanceCostPerHour,
  calculateFilamentPricePerKg,
  calculateWasteCost,
  type ProductionCostSnapshot,
} from '@/lib/costing'
import { revalidatePath } from 'next/cache'
import { Prisma, type ProductionStatus, type SupplyUnit } from '@prisma/client'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return productionRunSchema.safeParse({
    ...raw,
    notes: raw.notes || null,
    wasteReason: raw.wasteReason || null,
  })
}

// Spec §5.4 -- computed once at creation, never recomputed afterwards.
// CANCELADA is set exclusively by cancelProductionRun (never here).
function computeStatus(quantitySuccess: number, quantityFailed: number, quantityPlanned: number): ProductionStatus {
  if (quantityFailed > 0) return 'COM_FALHAS'
  if (quantitySuccess < quantityPlanned) return 'PARCIAL'
  return 'CONCLUIDA'
}

// Supply quantities in an insufficiency message carry their registered unit
// (spec §5.2 example: "Cola Quente (necessário 20ml, disponível 15ml)").
// Accessories have no unit dimension, so they're formatted as bare numbers.
const SUPPLY_UNIT_SUFFIX: Record<SupplyUnit, string> = { UN: '', ML: 'ml', G: 'g', M: 'm', OUTRO: '' }
function formatSupplyQuantity(unit: SupplyUnit, qty: number): string {
  return `${qty}${SUPPLY_UNIT_SUFFIX[unit]}`
}

// Everything createProductionRun needs about a resource to (a) check it has
// enough stock and (b) render its own "Label (necessário X, disponível Y)"
// fragment (each resource kind formats its quantities differently -- supply
// quantities carry a unit suffix, accessories/filament don't) -- so the
// pre-transaction check below is one flat list + filter instead of three
// near-duplicate blocks (spec §5.2: check ALL resources at once, list ALL
// shortfalls, not just the first one found).
interface ResourceCheck {
  needed: number
  available: number
  describe: () => string
}

// The stock-sufficiency check below cannot be expressed in the Zod schema
// alone because it depends on a database read (current stock of the
// filament AND every accessory/supply the product's ficha técnica uses).
// ALL resources are checked before any write happens -- a shortfall on any
// one of them blocks the whole thing and names every shortfall found, not
// just the first (spec §5.2, task-7 brief). The create + every decrement
// then run in ONE $transaction, so a run that passes the check never
// partially applies (row created but some stock untouched, or vice versa) --
// same atomicity guarantee the pre-existing filament-only version had,
// extended to accessories/supplies.
//
// Packaging is deliberately NOT stock-checked/decremented here even though
// spec §5.2/§5.3's prose mentions "PackagingItem" alongside Accessory/Supply:
// PackagingItem (schema) has no `currentStock` field and no purchase/restock
// model anywhere in this plan (spec §2 explicitly says embalagem is "sem
// mudança", and non-objectives §7 never proposes adding one). Adding a
// stock counter now, with no way to ever replenish it, would make it
// monotonically decrease to zero and then permanently block production for
// every product using that packaging -- a regression, not a feature. So its
// unitCost still flows into costSnapshot (via buildProductionCostSnapshot's
// existing consumedResources.packaging, unchanged from Task 5) for cost
// accounting/reversal bookkeeping, but no stock balance is checked or
// touched for it. Flagged explicitly in the task report as a deviation from
// the brief's literal wording, with rationale.
export async function createProductionRun(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const data = parsed.data

  const [product, printer, filament, settings, productPart] = await Promise.all([
    prisma.product.findUniqueOrThrow({
      where: { id: data.productId },
      include: {
        packagingItem: true,
        accessoryUsages: { include: { accessory: true } },
        supplyUsages: { include: { supply: true } },
      },
    }),
    prisma.printer.findUniqueOrThrow({ where: { id: data.printerId } }),
    prisma.filament.findUniqueOrThrow({ where: { id: data.filamentId } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    data.productPartId ? prisma.productPart.findUniqueOrThrow({ where: { id: data.productPartId } }) : null,
  ])

  // --- Pre-transaction check across ALL resources (spec §5.2) ---
  const totalFilamentConsumed = data.gramsUsed + data.gramsWasted
  const filamentAvailable = filament.currentStockGrams.toNumber()
  const checks: ResourceCheck[] = [
    {
      needed: totalFilamentConsumed,
      available: filamentAvailable,
      describe: () => `${filament.manufacturer} ${filament.material} ${filament.colorName} (necessário ${totalFilamentConsumed}g, disponível ${filamentAvailable}g)`,
    },
    // 2.1: uma produção de PEÇA não consome insumos/acessórios do produto
    // montado -- esses só são consumidos na montagem (spec 2.3).
    ...(productPart ? [] : product.accessoryUsages.map((u): ResourceCheck => {
      const needed = u.quantity.toNumber() * data.quantitySuccess
      const available = u.accessory.currentStock.toNumber()
      return { needed, available, describe: () => `${u.accessory.name} (necessário ${needed}, disponível ${available})` }
    })),
    ...(productPart ? [] : product.supplyUsages.map((u): ResourceCheck => {
      const needed = u.quantity.toNumber() * data.quantitySuccess
      const available = u.supply.currentStock.toNumber()
      return {
        needed,
        available,
        describe: () => `${u.supply.name} (necessário ${formatSupplyQuantity(u.supply.unit, needed)}, disponível ${formatSupplyQuantity(u.supply.unit, available)})`,
      }
    })),
  ]
  const insufficient = checks.filter((c) => c.needed > c.available)
  if (insufficient.length > 0) {
    return { success: false, error: `Estoque insuficiente: ${insufficient.map((c) => c.describe()).join('; ')}` }
  }

  // --- Historical cost snapshot (spec §4/§5.4) -- calculated once, from
  // Printer/Filament/Settings/Product as they stand right now, then never
  // recalculated again for this run.
  const printerDepreciationCostPerHour = calculatePrinterDepreciationCostPerHour({
    purchasePrice: printer.purchasePrice.toNumber(),
    depreciationHours: printer.depreciationHours.toNumber(),
  })
  const printerMaintenanceCostPerHour = calculatePrinterMaintenanceCostPerHour({
    purchasePrice: printer.purchasePrice.toNumber(),
    annualMaintenancePercent: settings.annualMaintenancePercent.toNumber(),
    annualUsageHours: settings.annualUsageHours.toNumber(),
  })
  const filamentPricePerKg = calculateFilamentPricePerKg({
    spoolPrice: filament.spoolPrice.toNumber(),
    spoolWeightKg: filament.spoolWeightKg.toNumber(),
  })

  const snapshot = buildProductionCostSnapshot(
    {
      includeDepreciation: settings.includeDepreciation,
      includeEnergyCost: settings.includeEnergyCost,
      includeMaintenance: settings.includeMaintenance,
      includeLaborCost: settings.includeLaborCost,
      includeFailureRate: settings.includeFailureRate,
      includeFilamentCost: settings.includeFilamentCost,
      includeAccessoriesCost: settings.includeAccessoriesCost,
      includeSuppliesCost: settings.includeSuppliesCost,
      includePackagingCost: settings.includePackagingCost,
      filamentId: filament.id,
      // 2.1 Produto composto: uma produção de PEÇA usa o peso/tempo dessa
      // peça (não o resumo agregado do produto composto, que somaria TODAS
      // as peças e infla o custo de imprimir só uma). Embalagem/insumos/
      // acessórios/mão de obra são conceito de produto MONTADO -- ficam
      // zerados aqui e entram no custo só na montagem (spec 2.3, ainda não
      // implementada), nunca duplicados na impressão de cada peça avulsa.
      weightGrams: productPart ? productPart.weightGrams.toNumber() : product.weightGrams.toNumber(),
      printTimeHours: productPart ? productPart.printTimeHours.toNumber() : product.printTimeHours.toNumber(),
      laborTimeHours: productPart ? 0 : product.laborTimeHours.toNumber(),
      filamentPricePerKg,
      printerAvgPowerConsumptionKwh: printer.avgPowerConsumptionKwh.toNumber(),
      printerDepreciationCostPerHour,
      printerMaintenanceCostPerHour,
      packagingItemId: productPart ? null : product.packagingItemId,
      packagingCost: productPart ? 0 : (product.packagingItem?.unitCost.toNumber() ?? 0),
      accessoryUsages: productPart
        ? []
        : product.accessoryUsages.map((u) => ({
            accessoryId: u.accessoryId,
            quantity: u.quantity.toNumber(),
            avgUnitCost: u.accessory.avgUnitCost.toNumber(),
          })),
      supplyUsages: productPart
        ? []
        : product.supplyUsages.map((u) => ({
            supplyId: u.supplyId,
            quantity: u.quantity.toNumber(),
            avgUnitCost: u.supply.avgUnitCost.toNumber(),
          })),
      quantityPlanned: data.quantityPlanned,
      quantitySuccess: data.quantitySuccess,
      quantityFailed: data.quantityFailed,
      gramsUsed: data.gramsUsed,
      gramsWasted: data.gramsWasted,
      timeWastedHours: data.timeWastedHours,
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

  const status = computeStatus(data.quantitySuccess, data.quantityFailed, data.quantityPlanned)

  // --- Single transaction: create the run + decrement every resource it
  // actually consumed. All or nothing (spec §5.3).
  await prisma.$transaction([
    prisma.productionRun.create({
      data: {
        ...data,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        status,
      },
    }),
    prisma.filament.update({
      where: { id: data.filamentId },
      data: { currentStockGrams: { decrement: totalFilamentConsumed } },
    }),
    ...snapshot.consumedResources.accessories.map((a) =>
      prisma.accessory.update({ where: { id: a.accessoryId }, data: { currentStock: { decrement: a.quantityConsumed } } }),
    ),
    ...snapshot.consumedResources.supplies.map((s) =>
      prisma.supply.update({ where: { id: s.supplyId }, data: { currentStock: { decrement: s.quantityConsumed } } }),
    ),
  ])

  revalidatePath('/production')
  revalidatePath('/filaments')
  revalidatePath('/accessories')
  revalidatePath('/supplies')
  return { success: true }
}

// Edita uma produção já registrada (spec do módulo Produção): quantidade e
// filamento ficam sempre somente leitura -- só desperdício (gramas/tempo/
// motivo) e observações mudam, preservando a integridade histórica. Ajusta
// o estoque de filamento pela DIFERENÇA de gramas desperdiçadas (não
// reaplica o total) e recalcula wasteCost/total do costSnapshot a partir
// das taxas ATUAIS de impressora/filamento/energia -- mesma limitação já
// aceita em getSaleProfit/legacy fallback pra runs sem snapshot: sem uma
// cópia congelada das taxas originais além do próprio unitCost, não há como
// reconstruir o wasteCost exatamente como era no momento da criação.
// Cancelada nunca é editável (já revertida, nada a preservar).
export async function updateProductionRun(id: string, formData: FormData): Promise<ActionResult> {
  const run = await prisma.productionRun.findUniqueOrThrow({ where: { id } })
  if (run.status === 'CANCELADA') {
    return { success: false, error: 'Uma produção cancelada não pode ser editada.' }
  }

  const parsed = productionRunWasteUpdateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { gramsWasted, timeWastedHours, wasteReason, notes } = parsed.data

  const [printer, filament, settings] = await Promise.all([
    prisma.printer.findUniqueOrThrow({ where: { id: run.printerId } }),
    prisma.filament.findUniqueOrThrow({ where: { id: run.filamentId } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])

  const oldGramsWasted = run.gramsWasted.toNumber()
  const deltaGrams = gramsWasted - oldGramsWasted
  const filamentAvailable = filament.currentStockGrams.toNumber()
  if (deltaGrams > filamentAvailable) {
    return {
      success: false,
      error: `Estoque insuficiente de filamento para esse desperdício (necessário ${deltaGrams}g a mais, disponível ${filamentAvailable}g)`,
    }
  }

  const printerDepreciationCostPerHour = calculatePrinterDepreciationCostPerHour({
    purchasePrice: printer.purchasePrice.toNumber(),
    depreciationHours: printer.depreciationHours.toNumber(),
  })
  const printerMaintenanceCostPerHour = calculatePrinterMaintenanceCostPerHour({
    purchasePrice: printer.purchasePrice.toNumber(),
    annualMaintenancePercent: settings.annualMaintenancePercent.toNumber(),
    annualUsageHours: settings.annualUsageHours.toNumber(),
  })
  const filamentPricePerKg = calculateFilamentPricePerKg({
    spoolPrice: filament.spoolPrice.toNumber(),
    spoolWeightKg: filament.spoolWeightKg.toNumber(),
  })
  const newWasteCost = calculateWasteCost({
    gramsWasted,
    timeWastedHours,
    filamentPricePerKg,
    printerDepreciationCostPerHour,
    printerMaintenanceCostPerHour,
    printerAvgPowerConsumptionKwh: printer.avgPowerConsumptionKwh.toNumber(),
    energyCostPerKwh: settings.energyCostPerKwh.toNumber(),
  })

  const oldSnapshot = run.costSnapshot as unknown as ProductionCostSnapshot | null
  const newSnapshot: ProductionCostSnapshot | null = oldSnapshot
    ? {
        ...oldSnapshot,
        wasteCost: newWasteCost,
        total: oldSnapshot.unitCost.finalCost * oldSnapshot.quantitySuccess + newWasteCost,
        consumedResources: {
          ...oldSnapshot.consumedResources,
          filament: { ...oldSnapshot.consumedResources.filament, gramsWasted },
        },
      }
    : null

  await prisma.$transaction([
    prisma.productionRun.update({
      where: { id },
      data: {
        gramsWasted,
        timeWastedHours,
        wasteReason,
        notes,
        ...(newSnapshot ? { costSnapshot: newSnapshot as unknown as Prisma.InputJsonValue } : {}),
      },
    }),
    ...(deltaGrams !== 0
      ? [prisma.filament.update({ where: { id: run.filamentId }, data: { currentStockGrams: { decrement: deltaGrams } } })]
      : []),
  ])

  revalidatePath('/production')
  revalidatePath('/filaments')
  return { success: true }
}

// Physical delete: ProductionRun is a historical log, not a catalog entity,
// so unlike Printer/Filament/PackagingItem/Accessory/Supply/Product there is
// no soft-delete flag — removing a row (e.g. to fix a typo) really deletes it.
//
// createProductionRun decrements Filament.currentStockGrams (and, since Task
// 7, every consumed Accessory/Supply) when the run is recorded. Deleting a
// run is the documented way to correct a mistake (e.g. wrong data entry), so
// it must reverse ALL of that -- otherwise using the documented correction
// path permanently and silently understates stock. Uses costSnapshot's
// consumedResources (same source cancelProductionRun reads) when present; a
// legacy pre-Task-7 row (costSnapshot null) only ever consumed filament, so
// only that is restored for it.
//
// Guard against double restoration: a CANCELADA run already had every
// resource restored by cancelProductionRun, so deleting it afterward (e.g.
// purging old cancelled history) must NOT touch stock again.
export async function deleteProductionRun(id: string): Promise<ActionResult> {
  const run = await prisma.productionRun.findUniqueOrThrow({ where: { id } })

  const ops: Prisma.PrismaPromise<unknown>[] = [prisma.productionRun.delete({ where: { id } })]

  if (run.status !== 'CANCELADA') {
    const snapshot = run.costSnapshot as unknown as ProductionCostSnapshot | null
    if (snapshot?.consumedResources) {
      const { filament, accessories, supplies } = snapshot.consumedResources
      ops.push(
        prisma.filament.update({
          where: { id: filament.filamentId },
          data: { currentStockGrams: { increment: filament.gramsUsed + filament.gramsWasted } },
        }),
      )
      for (const a of accessories) {
        ops.push(prisma.accessory.update({ where: { id: a.accessoryId }, data: { currentStock: { increment: a.quantityConsumed } } }))
      }
      for (const s of supplies) {
        ops.push(prisma.supply.update({ where: { id: s.supplyId }, data: { currentStock: { increment: s.quantityConsumed } } }))
      }
    } else {
      // Legacy row predating costSnapshot: only filament was ever consumed.
      ops.push(
        prisma.filament.update({
          where: { id: run.filamentId },
          data: { currentStockGrams: { increment: run.gramsUsed.plus(run.gramsWasted) } },
        }),
      )
    }
  }

  await prisma.$transaction(ops)

  revalidatePath('/production')
  revalidatePath('/filaments')
  revalidatePath('/accessories')
  revalidatePath('/supplies')
  return { success: true }
}

// Spec §5.5: cancels a production run WITHOUT deleting it (history is kept —
// quantityFailed/gramsWasted etc. stay visible as a record of what actually
// happened), reversing every resource it consumed using the quantities
// recorded in costSnapshot.consumedResources at creation time — never the
// product's current ficha técnica, which may have changed since (an
// accessory swapped out, a quantity edited, a supply removed entirely).
// Reading from the frozen snapshot instead of re-deriving from Product's
// live relations is exactly what makes this correct after such an edit.
//
// Guarded against being called twice on the same run (which would restore
// stock a second time) and against an empty reason.
export async function cancelProductionRun(id: string, reason: string): Promise<ActionResult> {
  const trimmedReason = reason?.trim()
  if (!trimmedReason) return { success: false, error: 'Motivo do cancelamento é obrigatório' }

  const run = await prisma.productionRun.findUniqueOrThrow({ where: { id } })
  if (run.status === 'CANCELADA') {
    return { success: false, error: 'Esta produção já foi cancelada' }
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.productionRun.update({
      where: { id },
      data: { status: 'CANCELADA', cancelReason: trimmedReason, cancelDate: new Date() },
    }),
  ]

  const snapshot = run.costSnapshot as unknown as ProductionCostSnapshot | null
  if (snapshot?.consumedResources) {
    const { filament, accessories, supplies } = snapshot.consumedResources
    ops.push(
      prisma.filament.update({
        where: { id: filament.filamentId },
        data: { currentStockGrams: { increment: filament.gramsUsed + filament.gramsWasted } },
      }),
    )
    for (const a of accessories) {
      ops.push(prisma.accessory.update({ where: { id: a.accessoryId }, data: { currentStock: { increment: a.quantityConsumed } } }))
    }
    for (const s of supplies) {
      ops.push(prisma.supply.update({ where: { id: s.supplyId }, data: { currentStock: { increment: s.quantityConsumed } } }))
    }
    // Packaging is not stock-tracked (see createProductionRun's note above),
    // so there is nothing to restore for consumedResources.packaging.
  } else {
    // Legacy row predating costSnapshot: fall back to what it recorded
    // directly, same as deleteProductionRun's pre-Task-7 path — only
    // filament was ever consumed by a run created before this task.
    ops.push(
      prisma.filament.update({
        where: { id: run.filamentId },
        data: { currentStockGrams: { increment: run.gramsUsed.plus(run.gramsWasted) } },
      }),
    )
  }

  await prisma.$transaction(ops)

  revalidatePath('/production')
  revalidatePath('/filaments')
  revalidatePath('/accessories')
  revalidatePath('/supplies')
  return { success: true }
}
