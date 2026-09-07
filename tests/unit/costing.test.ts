import { describe, it, expect } from 'vitest'
import {
  calculatePrinterDepreciationCostPerHour,
  calculateFilamentPricePerKg,
  calculateProductCost,
  calculateWasteCost,
} from '@/lib/costing'

describe('calculatePrinterDepreciationCostPerHour', () => {
  it('Bambu Lab A1 Mini', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3000, maintenanceCost: 700, depreciationHours: 10000 })).toBeCloseTo(0.37, 4)
  })
  it('Anycubic Kobra X', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3600, maintenanceCost: 1000, depreciationHours: 10000 })).toBeCloseTo(0.46, 4)
  })
})

describe('calculateFilamentPricePerKg', () => {
  it('Outro: 80/1kg', () => {
    expect(calculateFilamentPricePerKg({ spoolPrice: 80, spoolWeightKg: 1 })).toBeCloseTo(80, 4)
  })
})

describe('calculateProductCost', () => {
  const settings = {
    energyCostPerKwh: 1,
    laborCostPerHour: 10,
    failureRatePercent: 0.10,
    marketplaceFeePercent: 0.20,
    taxPercent: 0.055,
    marketplaceFixedFee: 4,
    defaultMarkup: 2,
  }

  it('Chaveirinho (planilha): Anycubic Kobra X + filamento Outro', () => {
    const result = calculateProductCost({
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.05,
      filamentPricePerKg: 80,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.46,
      suppliesCost: 0.3,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    expect(result.filamentCost).toBeCloseTo(2.4, 3)
    expect(result.electricityCost).toBeCloseTo(0.54, 3)
    expect(result.printerCost).toBeCloseTo(0.92, 3)
    expect(result.laborCost).toBeCloseTo(0.5, 3)
    expect(result.subtotal).toBeCloseTo(4.66, 3)
    expect(result.finalCost).toBeCloseTo(5.126, 3)
    expect(result.suggestedPrice).toBeCloseTo(10.252, 3)
  })

  it('Boneco Corinthias (planilha): confirma subtotal e markup', () => {
    const result = calculateProductCost({
      weightGrams: 300,
      printTimeHours: 20,
      laborTimeHours: 1,
      filamentPricePerKg: 100,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.46,
      suppliesCost: 0,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    expect(result.filamentCost).toBeCloseTo(30, 3)
    expect(result.electricityCost).toBeCloseTo(5.4, 3)
    expect(result.printerCost).toBeCloseTo(9.2, 3)
    expect(result.laborCost).toBeCloseTo(10, 3)
    expect(result.subtotal).toBeCloseTo(54.6, 3)
    expect(result.finalCost).toBeCloseTo(60.06, 3)
    expect(result.suggestedPrice).toBeCloseTo(120.12, 3)
  })

  it('marketplacePrice a partir de um suggestedPrice conhecido', () => {
    const result = calculateProductCost({
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.25,
      filamentPricePerKg: 80,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.46,
      suppliesCost: 0.3,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    // subtotal = 2.4 + 0.54 + 0.92 + 2.5 + 0.3 = 6.66 -> finalCost 7.326 -> suggested 14.652
    expect(result.suggestedPrice).toBeCloseTo(14.652, 3)
    expect(result.marketplacePrice).toBeCloseTo(23.667, 2)
  })
})

describe('calculateWasteCost', () => {
  it('calcula custo de filamento e tempo perdidos em uma falha de impressão', () => {
    // 20g desperdiçados a R$80/kg -> R$1.60; 0.5h perdida a (0.46 dep + 1 * 0.27 energia)/h -> R$0.365
    const result = calculateWasteCost({
      gramsWasted: 20,
      timeWastedHours: 0.5,
      filamentPricePerKg: 80,
      printerDepreciationCostPerHour: 0.46,
      printerAvgPowerConsumptionKwh: 0.27,
      energyCostPerKwh: 1,
    })
    expect(result).toBeCloseTo(1.965, 3)
  })

  it('retorna 0 quando não há desperdício', () => {
    const result = calculateWasteCost({
      gramsWasted: 0,
      timeWastedHours: 0,
      filamentPricePerKg: 80,
      printerDepreciationCostPerHour: 0.46,
      printerAvgPowerConsumptionKwh: 0.27,
      energyCostPerKwh: 1,
    })
    expect(result).toBe(0)
  })
})
