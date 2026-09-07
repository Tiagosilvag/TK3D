import { describe, it, expect } from 'vitest'
import {
  calculatePrinterDepreciationCostPerHour,
  calculatePrinterMaintenanceCostPerHour,
  calculateFilamentPricePerKg,
  calculateProductCost,
  calculateWasteCost,
} from '@/lib/costing'

describe('calculatePrinterDepreciationCostPerHour (no maintenance folded in)', () => {
  it('Bambu Lab A1 Mini: 3000 / 10000h', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3000, depreciationHours: 10000 })).toBeCloseTo(0.30, 4)
  })
  it('Anycubic Kobra X: 3600 / 10000h', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3600, depreciationHours: 10000 })).toBeCloseTo(0.36, 4)
  })
})

describe('calculatePrinterMaintenanceCostPerHour', () => {
  it('exemplo da spec: 3000 * 10% / 8000h', () => {
    expect(calculatePrinterMaintenanceCostPerHour({ purchasePrice: 3000, annualMaintenancePercent: 0.10, annualUsageHours: 8000 })).toBeCloseTo(0.0375, 4)
  })
  it('Anycubic Kobra X com defaults de Settings (10% / 2000h)', () => {
    expect(calculatePrinterMaintenanceCostPerHour({ purchasePrice: 3600, annualMaintenancePercent: 0.10, annualUsageHours: 2000 })).toBeCloseTo(0.18, 4)
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

  // Anycubic Kobra X: purchasePrice 3600, depreciationHours 10000 -> depreciation 0.36 R$/h
  // Settings defaults: annualMaintenancePercent 0.10, annualUsageHours 2000 -> maintenance 3600*0.10/2000 = 0.18 R$/h
  it('Chaveirinho (planilha): Anycubic Kobra X + filamento Outro', () => {
    const result = calculateProductCost({
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.05,
      filamentPricePerKg: 80,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.36,
      printerMaintenanceCostPerHour: 0.18,
      suppliesCost: 0.3,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    // filamentCost = 30 * (80/1000) = 2.4
    // electricityCost = 0.27 * 1 * 2 = 0.54
    // printerCost = 0.36 * 2 = 0.72
    // maintenanceCost = 0.18 * 2 = 0.36
    // laborCost = 10 * 0.05 = 0.5
    // subtotal = 2.4 + 0.54 + 0.72 + 0.36 + 0.5 + 0.3 = 4.82
    // finalCost = 4.82 * 1.10 = 5.302
    // suggestedPrice = 5.302 * 2 = 10.604
    expect(result.filamentCost).toBeCloseTo(2.4, 3)
    expect(result.electricityCost).toBeCloseTo(0.54, 3)
    expect(result.printerCost).toBeCloseTo(0.72, 3)
    expect(result.maintenanceCost).toBeCloseTo(0.36, 3)
    expect(result.laborCost).toBeCloseTo(0.5, 3)
    expect(result.subtotal).toBeCloseTo(4.82, 3)
    expect(result.finalCost).toBeCloseTo(5.302, 3)
    expect(result.suggestedPrice).toBeCloseTo(10.604, 3)
  })

  it('Boneco Corinthians (planilha): confirma subtotal e markup', () => {
    const result = calculateProductCost({
      weightGrams: 300,
      printTimeHours: 20,
      laborTimeHours: 1,
      filamentPricePerKg: 100,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.36,
      printerMaintenanceCostPerHour: 0.18,
      suppliesCost: 0,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    // filamentCost = 300 * (100/1000) = 30
    // electricityCost = 0.27 * 1 * 20 = 5.4
    // printerCost = 0.36 * 20 = 7.2
    // maintenanceCost = 0.18 * 20 = 3.6
    // laborCost = 10 * 1 = 10
    // subtotal = 30 + 5.4 + 7.2 + 3.6 + 10 = 56.2
    // finalCost = 56.2 * 1.10 = 61.82
    // suggestedPrice = 61.82 * 2 = 123.64
    expect(result.filamentCost).toBeCloseTo(30, 3)
    expect(result.electricityCost).toBeCloseTo(5.4, 3)
    expect(result.printerCost).toBeCloseTo(7.2, 3)
    expect(result.maintenanceCost).toBeCloseTo(3.6, 3)
    expect(result.laborCost).toBeCloseTo(10, 3)
    expect(result.subtotal).toBeCloseTo(56.2, 3)
    expect(result.finalCost).toBeCloseTo(61.82, 3)
    expect(result.suggestedPrice).toBeCloseTo(123.64, 3)
  })

  it('marketplacePrice a partir de um suggestedPrice conhecido', () => {
    const result = calculateProductCost({
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.25,
      filamentPricePerKg: 80,
      printerAvgPowerConsumptionKwh: 0.27,
      printerDepreciationCostPerHour: 0.36,
      printerMaintenanceCostPerHour: 0.18,
      suppliesCost: 0.3,
      packagingCost: 0,
      accessoryCost: 0,
    }, settings)

    // subtotal = 2.4 + 0.54 + 0.72 + 0.36 + 2.5 + 0.3 = 6.82 -> finalCost 7.502 -> suggested 15.004
    // marketplacePrice = 15.004 / (1 - 0.20 - 0.055) + 4 = 15.004 / 0.745 + 4 ≈ 24.1396
    expect(result.suggestedPrice).toBeCloseTo(15.004, 3)
    expect(result.marketplacePrice).toBeCloseTo(24.1396, 2)
  })
})

describe('calculateWasteCost', () => {
  it('calcula custo de filamento e tempo perdidos em uma falha de impressão', () => {
    // Anycubic Kobra X: purchasePrice 3600, depreciationHours 10000 -> depreciation 0.36 R$/h
    // Settings defaults (annualMaintenancePercent 0.10, annualUsageHours 2000) -> maintenance 3600*0.10/2000 = 0.18 R$/h
    // 20g desperdiçados a R$80/kg -> R$1.60
    // 0.5h perdida a (0.36 dep + 0.18 manutenção + 1 * 0.27 energia)/h = 0.81/h -> R$0.405
    // total = 1.6 + 0.405 = 2.005
    const result = calculateWasteCost({
      gramsWasted: 20,
      timeWastedHours: 0.5,
      filamentPricePerKg: 80,
      printerDepreciationCostPerHour: 0.36,
      printerMaintenanceCostPerHour: 0.18,
      printerAvgPowerConsumptionKwh: 0.27,
      energyCostPerKwh: 1,
    })
    expect(result).toBeCloseTo(2.005, 3)
  })

  it('retorna 0 quando não há desperdício', () => {
    const result = calculateWasteCost({
      gramsWasted: 0,
      timeWastedHours: 0,
      filamentPricePerKg: 80,
      printerDepreciationCostPerHour: 0.36,
      printerMaintenanceCostPerHour: 0.18,
      printerAvgPowerConsumptionKwh: 0.27,
      energyCostPerKwh: 1,
    })
    expect(result).toBe(0)
  })
})
