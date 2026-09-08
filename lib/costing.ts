export interface PrinterDepreciationInput {
  purchasePrice: number
  depreciationHours: number
}

export function calculatePrinterDepreciationCostPerHour(input: PrinterDepreciationInput): number {
  return input.purchasePrice / input.depreciationHours
}

export interface PrinterMaintenanceInput {
  purchasePrice: number
  annualMaintenancePercent: number
  annualUsageHours: number
}

export function calculatePrinterMaintenanceCostPerHour(input: PrinterMaintenanceInput): number {
  return (input.purchasePrice * input.annualMaintenancePercent) / input.annualUsageHours
}

export interface FilamentPriceInput {
  spoolPrice: number
  spoolWeightKg: number
}

export function calculateFilamentPricePerKg(input: FilamentPriceInput): number {
  return input.spoolPrice / input.spoolWeightKg
}

export function calculateFilamentPricePerGram(input: FilamentPriceInput): number {
  return calculateFilamentPricePerKg(input) / 1000
}

export interface StockStatus {
  emoji: string
  label: string
}

// Thresholds from the spec (§3.3): >30% em estoque, 10-30% baixo, 0-10% (exclusive
// of 0) crítico, <=0% esgotado.
export function getStockStatus(percentRemaining: number): StockStatus {
  if (percentRemaining <= 0) return { emoji: '⚫', label: 'Esgotado' }
  if (percentRemaining < 10) return { emoji: '🔴', label: 'Estoque crítico' }
  if (percentRemaining <= 30) return { emoji: '🟡', label: 'Estoque baixo' }
  return { emoji: '🟢', label: 'Em estoque' }
}

// Accessory/Supply stock status (spec §1.1/§1.3, task-3 brief): same shape
// as getStockStatus above, but with the low/critical thresholds passed in
// (as fractions, 0-1 -- same convention Settings stores every percentage
// in) instead of Filament's hardcoded 30%/10%. Accessories and Insumos are
// a deliberately independent, configurable stock system (Settings.
// stockLowThresholdPercent/stockCriticalThresholdPercent) -- Filament's
// getStockStatus above is untouched on purpose, to avoid regressing an
// already-tested, in-production threshold.
export function getStockStatusWithThresholds(
  percentRemaining: number,
  lowThresholdPercent: number,
  criticalThresholdPercent: number,
): StockStatus {
  if (percentRemaining <= 0) return { emoji: '⚫', label: 'Esgotado' }
  if (percentRemaining < criticalThresholdPercent * 100) return { emoji: '🔴', label: 'Estoque crítico' }
  if (percentRemaining <= lowThresholdPercent * 100) return { emoji: '🟡', label: 'Estoque baixo' }
  return { emoji: '🟢', label: 'Em estoque' }
}

// Weighted-average purchase cost (spec §1.1, task-3 brief): every new
// AccessoryPurchase (and, task 4, SupplyPurchase) folds into the running
// average instead of replacing it. Creating a brand-new Accessory is just
// this same formula starting from a zeroed-out stock (currentStock=0,
// avgUnitCost=0), which collapses to purchaseTotalCost/purchaseQuantity --
// so createAccessory and registerAccessoryPurchase share this one function.
export interface WeightedAverageCostInput {
  currentStock: number
  avgUnitCost: number
  purchaseQuantity: number
  purchaseTotalCost: number
}

export function calculateWeightedAverageCost(input: WeightedAverageCostInput): number {
  return (
    (input.currentStock * input.avgUnitCost + input.purchaseTotalCost) /
    (input.currentStock + input.purchaseQuantity)
  )
}

export interface Settings {
  energyCostPerKwh: number
  laborCostPerHour: number
  failureRatePercent: number
  marketplaceFeePercent: number
  taxPercent: number
  marketplaceFixedFee: number
  defaultMarkup: number
}

// Configurações §3 — "Composição do custo": one toggle per cost term. Each
// term is ALWAYS calculated and returned in ProductCostBreakdown (so a
// breakdown UI can still show the line, just marked visually disabled) —
// a flag only gates whether that term's value contributes to
// subtotal/finalCost (multiplied by 1 or 0 before summing).
export interface ProductCostFlags {
  includeDepreciation: boolean
  includeEnergyCost: boolean
  includeMaintenance: boolean
  includeLaborCost: boolean
  includeFailureRate: boolean
  includeFilamentCost: boolean
  includeAccessoriesCost: boolean
  includeSuppliesCost: boolean
  includePackagingCost: boolean
}

export interface ProductCostInput extends ProductCostFlags {
  weightGrams: number
  printTimeHours: number
  laborTimeHours: number
  filamentPricePerKg: number
  printerAvgPowerConsumptionKwh: number
  printerDepreciationCostPerHour: number
  printerMaintenanceCostPerHour: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
}

export interface ProductCostBreakdown {
  filamentCost: number
  electricityCost: number
  printerCost: number
  maintenanceCost: number
  laborCost: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
  // Always calculated (subtotal * failureRatePercent) regardless of
  // includeFailureRate, same transparency rule as every other term.
  failureRateCost: number
  subtotal: number
  finalCost: number
  suggestedPrice: number
  marketplacePrice: number
}

// Configurações §3 — modos de arredondamento do preço final.
export type RoundingMode = 'NONE' | 'R90' | 'R99' | 'R00'

const ROUNDING_FRACTION: Record<Exclude<RoundingMode, 'NONE'>, number> = {
  R90: 0.9,
  R99: 0.99,
  R00: 0,
}

/**
 * Applies a fixed-ending rounding rule to a final price (suggested or
 * marketplace) — NEVER to individual cost breakdown components.
 *
 * Rule (chosen because it reproduces the brief's own examples exactly):
 * truncate the value's integer part (`Math.floor`) and replace whatever
 * fractional part it had with a FIXED ending — .90, .99 or .00 — regardless
 * of whether the original fraction was above or below that ending. So
 * 23.45 -> 23.90 (fraction goes up) and 23.95 -> 23.90 (fraction goes down)
 * land on the exact same result, matching "R90 (...) ex: 23.45→23.90, mas
 * 23.95→23.90 também" from the brief. R00 fixes the fraction at .00, which
 * is equivalent to Math.floor. NONE is a no-op passthrough.
 */
export function applyRounding(value: number, mode: RoundingMode): number {
  if (mode === 'NONE') return value
  const integerPart = Math.floor(value)
  const rounded = integerPart + ROUNDING_FRACTION[mode]
  // Normalize away binary floating-point noise (e.g. 23 + 0.9 !== 23.9 bit
  // for bit) so callers get a clean 2-decimal currency value.
  return Math.round(rounded * 100) / 100
}

export interface WasteCostInput {
  gramsWasted: number
  timeWastedHours: number
  filamentPricePerKg: number
  printerDepreciationCostPerHour: number
  printerMaintenanceCostPerHour: number
  printerAvgPowerConsumptionKwh: number
  energyCostPerKwh: number
}

export function calculateWasteCost(input: WasteCostInput): number {
  const filamentWasteCost = input.gramsWasted * (input.filamentPricePerKg / 1000)
  const timeWasteCost = input.timeWastedHours * (input.printerDepreciationCostPerHour + input.printerMaintenanceCostPerHour + input.energyCostPerKwh * input.printerAvgPowerConsumptionKwh)
  return filamentWasteCost + timeWasteCost
}

function on(flag: boolean): number {
  return flag ? 1 : 0
}

// Ficha técnica §2 (task-5 brief): both ProductAccessoryUsage and
// ProductSupplyUsage are "list of {quantity, avgUnitCost}" rows that need
// the exact same reduction (sum of quantity * avgUnitCost) to turn into the
// single accessoryCost/suppliesCost number calculateProductCost expects.
// Extracted once so both call sites (getProductCostBreakdown and
// buildProductionCostSnapshot below) share one tested implementation
// instead of two ad-hoc reduce()s that could drift apart.
export interface UsageCostInput {
  quantity: number
  avgUnitCost: number
}

export function sumUsageCost(usages: UsageCostInput[]): number {
  return usages.reduce((sum, u) => sum + u.quantity * u.avgUnitCost, 0)
}

export function calculateProductCost(input: ProductCostInput, settings: Settings): ProductCostBreakdown {
  // Every term below is always calculated in full, regardless of its flag —
  // the breakdown must keep showing the real value (UI marks it visually
  // disabled instead of hiding it). Only the contribution to subtotal below
  // is gated by the flag.
  const filamentCost = input.weightGrams * (input.filamentPricePerKg / 1000)
  const electricityCost = input.printerAvgPowerConsumptionKwh * settings.energyCostPerKwh * input.printTimeHours
  const printerCost = input.printerDepreciationCostPerHour * input.printTimeHours
  const maintenanceCost = input.printerMaintenanceCostPerHour * input.printTimeHours
  const laborCost = settings.laborCostPerHour * input.laborTimeHours

  const subtotal =
    filamentCost * on(input.includeFilamentCost) +
    electricityCost * on(input.includeEnergyCost) +
    printerCost * on(input.includeDepreciation) +
    maintenanceCost * on(input.includeMaintenance) +
    laborCost * on(input.includeLaborCost) +
    input.suppliesCost * on(input.includeSuppliesCost) +
    input.packagingCost * on(input.includePackagingCost) +
    input.accessoryCost * on(input.includeAccessoriesCost)

  // Failure rate is applied as a markup on top of subtotal (not a flat
  // additive term), same shape as before the flags existed — always
  // calculated so the UI can show it, gated by includeFailureRate before
  // it contributes to finalCost.
  const failureRateCost = subtotal * settings.failureRatePercent
  const finalCost = subtotal + failureRateCost * on(input.includeFailureRate)

  const suggestedPrice = finalCost * settings.defaultMarkup
  const marketplacePrice = suggestedPrice / (1 - settings.marketplaceFeePercent - settings.taxPercent)
    + settings.marketplaceFixedFee

  return {
    filamentCost,
    electricityCost,
    printerCost,
    maintenanceCost,
    laborCost,
    suppliesCost: input.suppliesCost,
    packagingCost: input.packagingCost,
    accessoryCost: input.accessoryCost,
    failureRateCost,
    subtotal,
    finalCost,
    suggestedPrice,
    marketplacePrice,
  }
}

// ---------------------------------------------------------------------------
// "Simulação de preço" (spec §2, task-6 brief)
//
// A client-side-only pricing preview: the Products edit page lets the user
// temporarily override markup/margin/discount (never persisted, never fed
// back into calculateProductCost above, which stays exactly as Task 5 left
// it -- markup-only, still the canonical/persisted breakdown). This
// function is the one place margin/discount currently affect a price:
//   1. markup-based price = finalCost * markup, same shape as
//      calculateProductCost's suggestedPrice.
//   2. margin-based floor = finalCost / (1 - marginPercent) -- guarantees
//      the suggested price never implies less than the desired profit
//      margin, even if markup alone would undercut it.
//   3. suggestedPrice = max(1, 2), with a promotional discountPercent
//      applied on top of whichever wins.
//   4. marketplacePrice reuses calculateProductCost's exact fee/tax/
//      fixed-fee formula, applied to the (possibly discounted)
//      suggestedPrice above.
// With Settings' actual defaults (markup=2.00, margin=0.30, discount=0) the
// margin floor never binds and the discount is a no-op, so this reproduces
// calculateProductCost's suggestedPrice/marketplacePrice exactly -- this is
// what lets the UI show a default calculated price preview using Settings'
// current values before any simulation control is touched.
// ---------------------------------------------------------------------------

export interface PriceSimulationInput {
  finalCost: number
  markup: number
  marginPercent: number
  discountPercent: number
  marketplaceFeePercent: number
  taxPercent: number
  marketplaceFixedFee: number
}

export interface PriceSimulationResult {
  suggestedPrice: number
  marketplacePrice: number
}

export function simulateProductPrice(input: PriceSimulationInput): PriceSimulationResult {
  const markupPrice = input.finalCost * input.markup
  const marginFloorPrice = input.marginPercent >= 1 ? Infinity : input.finalCost / (1 - input.marginPercent)
  const basePrice = Math.max(markupPrice, marginFloorPrice)
  const suggestedPrice = basePrice * (1 - input.discountPercent)
  const marketplacePrice =
    suggestedPrice / (1 - input.marketplaceFeePercent - input.taxPercent) + input.marketplaceFixedFee
  return { suggestedPrice, marketplacePrice }
}

// ---------------------------------------------------------------------------
// Production cost snapshot (spec §4/§5, task-5 brief)
//
// Historical-cost architecture: a ProductionRun freezes its entire cost
// picture at creation time into a `costSnapshot Json` column that is never
// recalculated or rewritten afterwards — later Settings/Printer/Filament/
// Accessory/Supply changes must never alter an already-recorded run's cost
// (spec §4). buildProductionCostSnapshot is the ONE place that shape gets
// built, so its return type here IS the exact contract stored in that
// column and read back by every later screen (production history, cost
// column, dashboard aggregation) and by cancelProductionRun's reversal
// logic (Task 6+ of this plan) — those consumers exist to be built on top
// of this shape, not the other way around, so changing field names/shapes
// here later is a breaking migration of every already-stored JSON row.
//
// Deliberately built from plain-number inputs (like every other function in
// this file) rather than Prisma models, so it's callable from a pure unit
// test with zero DB/Decimal setup — the caller (an actions/ file) is
// responsible for `.toNumber()`-ing Decimals and shaping ProductAccessoryUsage/
// ProductSupplyUsage rows into the plain {id, quantity, avgUnitCost} shape
// below before calling this.
// ---------------------------------------------------------------------------

export interface ProductionAccessoryUsageInput {
  accessoryId: string
  quantity: number // per single unit of product, i.e. the ficha técnica quantity
  avgUnitCost: number // Accessory.avgUnitCost at production time
}

export interface ProductionSupplyUsageInput {
  supplyId: string
  quantity: number // per single unit of product
  avgUnitCost: number // Supply.avgUnitCost at production time
}

export interface ProductionCostSnapshotInput extends ProductCostFlags {
  // Ficha técnica (per single unit) — same fields calculateProductCost takes,
  // minus the already-summed suppliesCost/accessoryCost (computed internally
  // below via sumUsageCost from the lists instead).
  weightGrams: number
  printTimeHours: number
  laborTimeHours: number
  filamentPricePerKg: number
  printerAvgPowerConsumptionKwh: number
  printerDepreciationCostPerHour: number
  printerMaintenanceCostPerHour: number
  packagingCost: number
  accessoryUsages: ProductionAccessoryUsageInput[]
  supplyUsages: ProductionSupplyUsageInput[]

  // Resource identities needed to record (and later reverse) consumption —
  // not used in any cost formula, only copied into consumedResources below.
  filamentId: string
  packagingItemId: string | null

  // This specific production run.
  quantityPlanned: number
  quantitySuccess: number // only these consume accessories/insumos/embalagem (spec §5.1)
  quantityFailed: number
  gramsUsed: number
  gramsWasted: number
  timeWastedHours: number
}

// Everything Task 7's cancelProductionRun needs to reverse stock WITHOUT
// re-querying the product's current ficha técnica (which may have changed
// since this run was created) — every resource actually touched, by id,
// with the exact quantity consumed and the unit cost that was in effect at
// the time (spec §5.1/§5.5, task-5 brief).
export interface ProductionResourceConsumption {
  filament: { filamentId: string; gramsUsed: number; gramsWasted: number }
  accessories: { accessoryId: string; quantityPerUnit: number; quantityConsumed: number; unitCost: number }[]
  supplies: { supplyId: string; quantityPerUnit: number; quantityConsumed: number; unitCost: number }[]
  packaging: { packagingItemId: string; quantityConsumed: number; unitCost: number } | null
}

export interface ProductionCostSnapshot {
  quantityPlanned: number
  quantitySuccess: number
  quantityFailed: number
  // Per-unit cost breakdown, identical shape to calculateProductCost's
  // output, computed once here from Printer/Filament/Settings/Product as
  // they stood at production time (spec §4).
  unitCost: ProductCostBreakdown
  // Cost of the grams/time lost to failed units (calculateWasteCost), kept
  // as a separate additive term rather than folded into unitCost.finalCost
  // — it belongs to the run as a whole, not to any single successful unit.
  wasteCost: number
  // The number every later screen reads instead of recalculating (spec §4/
  // Task 8-9: "coluna Custo lê costSnapshot.total", dashboard sums it):
  // cost of every successful unit produced, plus whatever was wasted on the
  // failed ones.
  total: number
  consumedResources: ProductionResourceConsumption
}

export function buildProductionCostSnapshot(
  input: ProductionCostSnapshotInput,
  settings: Settings,
): ProductionCostSnapshot {
  const suppliesCost = sumUsageCost(input.supplyUsages)
  const accessoryCost = sumUsageCost(input.accessoryUsages)

  const unitCost = calculateProductCost(
    {
      weightGrams: input.weightGrams,
      printTimeHours: input.printTimeHours,
      laborTimeHours: input.laborTimeHours,
      filamentPricePerKg: input.filamentPricePerKg,
      printerAvgPowerConsumptionKwh: input.printerAvgPowerConsumptionKwh,
      printerDepreciationCostPerHour: input.printerDepreciationCostPerHour,
      printerMaintenanceCostPerHour: input.printerMaintenanceCostPerHour,
      suppliesCost,
      packagingCost: input.packagingCost,
      accessoryCost,
      includeDepreciation: input.includeDepreciation,
      includeEnergyCost: input.includeEnergyCost,
      includeMaintenance: input.includeMaintenance,
      includeLaborCost: input.includeLaborCost,
      includeFailureRate: input.includeFailureRate,
      includeFilamentCost: input.includeFilamentCost,
      includeAccessoriesCost: input.includeAccessoriesCost,
      includeSuppliesCost: input.includeSuppliesCost,
      includePackagingCost: input.includePackagingCost,
    },
    settings,
  )

  const wasteCost = calculateWasteCost({
    gramsWasted: input.gramsWasted,
    timeWastedHours: input.timeWastedHours,
    filamentPricePerKg: input.filamentPricePerKg,
    printerDepreciationCostPerHour: input.printerDepreciationCostPerHour,
    printerMaintenanceCostPerHour: input.printerMaintenanceCostPerHour,
    printerAvgPowerConsumptionKwh: input.printerAvgPowerConsumptionKwh,
    energyCostPerKwh: settings.energyCostPerKwh,
  })

  const total = unitCost.finalCost * input.quantitySuccess + wasteCost

  // Physical consumption is NEVER gated by the include* cost flags — those
  // only control whether a term counts toward the displayed subtotal/total,
  // they say nothing about whether the piece physically used the resource.
  // A produced unit always consumes its full ficha técnica.
  const consumedResources: ProductionResourceConsumption = {
    filament: {
      filamentId: input.filamentId,
      gramsUsed: input.gramsUsed,
      gramsWasted: input.gramsWasted,
    },
    accessories: input.accessoryUsages.map((u) => ({
      accessoryId: u.accessoryId,
      quantityPerUnit: u.quantity,
      quantityConsumed: u.quantity * input.quantitySuccess,
      unitCost: u.avgUnitCost,
    })),
    supplies: input.supplyUsages.map((u) => ({
      supplyId: u.supplyId,
      quantityPerUnit: u.quantity,
      quantityConsumed: u.quantity * input.quantitySuccess,
      unitCost: u.avgUnitCost,
    })),
    packaging: input.packagingItemId
      ? {
          packagingItemId: input.packagingItemId,
          quantityConsumed: input.quantitySuccess,
          unitCost: input.packagingCost,
        }
      : null,
  }

  return {
    quantityPlanned: input.quantityPlanned,
    quantitySuccess: input.quantitySuccess,
    quantityFailed: input.quantityFailed,
    unitCost,
    wasteCost,
    total,
    consumedResources,
  }
}
