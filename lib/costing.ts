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
