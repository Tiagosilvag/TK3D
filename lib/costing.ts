export interface PrinterDepreciationInput {
  purchasePrice: number
  maintenanceCost: number
  depreciationHours: number
}

export function calculatePrinterDepreciationCostPerHour(input: PrinterDepreciationInput): number {
  return (input.purchasePrice + input.maintenanceCost) / input.depreciationHours
}

export interface FilamentPriceInput {
  spoolPrice: number
  spoolWeightKg: number
}

export function calculateFilamentPricePerKg(input: FilamentPriceInput): number {
  return input.spoolPrice / input.spoolWeightKg
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

export interface ProductCostInput {
  weightGrams: number
  printTimeHours: number
  laborTimeHours: number
  filamentPricePerKg: number
  printerAvgPowerConsumptionKwh: number
  printerDepreciationCostPerHour: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
}

export interface ProductCostBreakdown {
  filamentCost: number
  electricityCost: number
  printerCost: number
  laborCost: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
  subtotal: number
  finalCost: number
  suggestedPrice: number
  marketplacePrice: number
}

export function calculateProductCost(input: ProductCostInput, settings: Settings): ProductCostBreakdown {
  const filamentCost = input.weightGrams * (input.filamentPricePerKg / 1000)
  const electricityCost = input.printerAvgPowerConsumptionKwh * settings.energyCostPerKwh * input.printTimeHours
  const printerCost = input.printerDepreciationCostPerHour * input.printTimeHours
  const laborCost = settings.laborCostPerHour * input.laborTimeHours

  const subtotal = filamentCost + electricityCost + printerCost + laborCost
    + input.suppliesCost + input.packagingCost + input.accessoryCost

  const finalCost = subtotal * (1 + settings.failureRatePercent)
  const suggestedPrice = finalCost * settings.defaultMarkup
  const marketplacePrice = suggestedPrice / (1 - settings.marketplaceFeePercent - settings.taxPercent)
    + settings.marketplaceFixedFee

  return {
    filamentCost,
    electricityCost,
    printerCost,
    laborCost,
    suppliesCost: input.suppliesCost,
    packagingCost: input.packagingCost,
    accessoryCost: input.accessoryCost,
    subtotal,
    finalCost,
    suggestedPrice,
    marketplacePrice,
  }
}
