import { describe, it, expect } from 'vitest'
import {
  calculatePrinterDepreciationCostPerHour,
  calculatePrinterMaintenanceCostPerHour,
  calculateFilamentPricePerKg,
  calculateFilamentPricePerGram,
  calculateProductCost,
  calculateWasteCost,
  getStockStatus,
  applyRounding,
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

describe('calculateFilamentPricePerGram', () => {
  it('é o preço por kg dividido por 1000', () => {
    expect(calculateFilamentPricePerGram({ spoolPrice: 80, spoolWeightKg: 1 })).toBeCloseTo(0.08, 5)
  })
  it('rolo de 1kg a R$120: R$0,12/g', () => {
    expect(calculateFilamentPricePerGram({ spoolPrice: 120, spoolWeightKg: 1 })).toBeCloseTo(0.12, 5)
  })
})

describe('getStockStatus', () => {
  it('acima de 30% -> em estoque', () => {
    expect(getStockStatus(31)).toEqual({ emoji: '🟢', label: 'Em estoque' })
    expect(getStockStatus(100)).toEqual({ emoji: '🟢', label: 'Em estoque' })
  })
  it('entre 10% e 30% (inclusive) -> estoque baixo', () => {
    expect(getStockStatus(30)).toEqual({ emoji: '🟡', label: 'Estoque baixo' })
    expect(getStockStatus(10)).toEqual({ emoji: '🟡', label: 'Estoque baixo' })
    expect(getStockStatus(20)).toEqual({ emoji: '🟡', label: 'Estoque baixo' })
  })
  it('entre 0 e 10% (exclusive) -> estoque crítico', () => {
    expect(getStockStatus(9.9)).toEqual({ emoji: '🔴', label: 'Estoque crítico' })
    expect(getStockStatus(0.1)).toEqual({ emoji: '🔴', label: 'Estoque crítico' })
  })
  it('0% ou menos -> esgotado', () => {
    expect(getStockStatus(0)).toEqual({ emoji: '⚫', label: 'Esgotado' })
    expect(getStockStatus(-5)).toEqual({ emoji: '⚫', label: 'Esgotado' })
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

  // The 9 include* flags gate a term's contribution to subtotal/finalCost
  // without removing it from the breakdown object (transparency — the UI
  // still shows the line, just marked visually disabled). All existing
  // fixtures below pass every flag as `true` so their expected totals stay
  // byte-for-byte identical to the pre-flags behavior.
  const allIncludeTrue = {
    includeDepreciation: true,
    includeEnergyCost: true,
    includeMaintenance: true,
    includeLaborCost: true,
    includeFailureRate: true,
    includeFilamentCost: true,
    includeAccessoriesCost: true,
    includeSuppliesCost: true,
    includePackagingCost: true,
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
      ...allIncludeTrue,
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
      ...allIncludeTrue,
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
      ...allIncludeTrue,
    }, settings)

    // subtotal = 2.4 + 0.54 + 0.72 + 0.36 + 2.5 + 0.3 = 6.82 -> finalCost 7.502 -> suggested 15.004
    // marketplacePrice = 15.004 / (1 - 0.20 - 0.055) + 4 = 15.004 / 0.745 + 4 ≈ 24.1396
    expect(result.suggestedPrice).toBeCloseTo(15.004, 3)
    expect(result.marketplacePrice).toBeCloseTo(24.1396, 2)
  })
})

describe('calculateProductCost — flags include* (Configurações §3)', () => {
  const settings = {
    energyCostPerKwh: 1,
    laborCostPerHour: 10,
    failureRatePercent: 0.10,
    marketplaceFeePercent: 0.20,
    taxPercent: 0.055,
    marketplaceFixedFee: 4,
    defaultMarkup: 2,
  }

  // Fixture where every one of the 8 additive terms is nonzero, so turning
  // any single flag off produces a visible, independently-verifiable delta
  // (the base costing.test.ts fixtures above have packagingCost/accessoryCost
  // at 0, which would silently "pass" even if those two flags did nothing).
  //
  // filamentCost    = 30 * (80/1000)          = 2.4
  // electricityCost = 0.27 * 1 * 2            = 0.54
  // printerCost     = 0.36 * 2                = 0.72
  // maintenanceCost = 0.18 * 2                = 0.36
  // laborCost       = 10 * 0.05               = 0.5
  // suppliesCost                              = 0.3
  // packagingCost                             = 0.2
  // accessoryCost                             = 0.15
  // subtotal (all flags on)                   = 5.17
  // finalCost = subtotal * 1.10               = 5.687
  const baseInput = {
    weightGrams: 30,
    printTimeHours: 2,
    laborTimeHours: 0.05,
    filamentPricePerKg: 80,
    printerAvgPowerConsumptionKwh: 0.27,
    printerDepreciationCostPerHour: 0.36,
    printerMaintenanceCostPerHour: 0.18,
    suppliesCost: 0.3,
    packagingCost: 0.2,
    accessoryCost: 0.15,
  }

  const allTrue = {
    includeDepreciation: true,
    includeEnergyCost: true,
    includeMaintenance: true,
    includeLaborCost: true,
    includeFailureRate: true,
    includeFilamentCost: true,
    includeAccessoriesCost: true,
    includeSuppliesCost: true,
    includePackagingCost: true,
  }

  it('com todas as flags ligadas, subtotal e finalCost batem com a soma de todos os termos', () => {
    const result = calculateProductCost({ ...baseInput, ...allTrue }, settings)
    expect(result.subtotal).toBeCloseTo(5.17, 4)
    expect(result.finalCost).toBeCloseTo(5.687, 4)
  })

  it.each([
    ['includeFilamentCost', 2.4],
    ['includeEnergyCost', 0.54],
    ['includeDepreciation', 0.72],
    ['includeMaintenance', 0.36],
    ['includeLaborCost', 0.5],
    ['includeSuppliesCost', 0.3],
    ['includePackagingCost', 0.2],
    ['includeAccessoriesCost', 0.15],
  ] as const)('desligar %s zera só a contribuição desse termo (%d) no subtotal/finalCost, resto intacto', (flag, termValue) => {
    const result = calculateProductCost({ ...baseInput, ...allTrue, [flag]: false }, settings)

    const expectedSubtotal = 5.17 - termValue
    const expectedFinalCost = expectedSubtotal * 1.10

    expect(result.subtotal).toBeCloseTo(expectedSubtotal, 4)
    expect(result.finalCost).toBeCloseTo(expectedFinalCost, 4)

    // The raw breakdown line is still always calculated/returned (UI needs
    // to display it, just marked visually disabled) — only its contribution
    // to subtotal/finalCost is zeroed, never the field itself.
    expect(result.filamentCost).toBeCloseTo(2.4, 4)
    expect(result.electricityCost).toBeCloseTo(0.54, 4)
    expect(result.printerCost).toBeCloseTo(0.72, 4)
    expect(result.maintenanceCost).toBeCloseTo(0.36, 4)
    expect(result.laborCost).toBeCloseTo(0.5, 4)
    expect(result.suppliesCost).toBeCloseTo(0.3, 4)
    expect(result.packagingCost).toBeCloseTo(0.2, 4)
    expect(result.accessoryCost).toBeCloseTo(0.15, 4)
  })

  it('desligar includeFailureRate zera só o acréscimo de taxa de falha (finalCost = subtotal), resto intacto', () => {
    const result = calculateProductCost({ ...baseInput, ...allTrue, includeFailureRate: false }, settings)
    expect(result.subtotal).toBeCloseTo(5.17, 4)
    expect(result.finalCost).toBeCloseTo(5.17, 4)
    expect(result.failureRateCost).toBeCloseTo(0.517, 4)
  })

  it('includeFailureRate ligado soma failureRateCost (subtotal * failureRatePercent) ao finalCost', () => {
    const result = calculateProductCost({ ...baseInput, ...allTrue }, settings)
    expect(result.failureRateCost).toBeCloseTo(0.517, 4)
    expect(result.finalCost).toBeCloseTo(result.subtotal + result.failureRateCost, 6)
  })
})

describe('applyRounding', () => {
  it('NONE retorna o valor sem alterações', () => {
    expect(applyRounding(23.45, 'NONE')).toBeCloseTo(23.45, 4)
    expect(applyRounding(100, 'NONE')).toBeCloseTo(100, 4)
    expect(applyRounding(0, 'NONE')).toBeCloseTo(0, 4)
  })

  it('R90 fixa a fração em ,90 (trunca a parte inteira, não arredonda pro próximo inteiro)', () => {
    // Exemplos do brief: 23.45 -> 23.90 e 23.95 -> 23.90 (mesmo resultado,
    // porque a regra trunca a parte inteira e sempre fixa a fração em .90 —
    // não importa se a fração original estava acima ou abaixo de .90).
    expect(applyRounding(23.45, 'R90')).toBeCloseTo(23.90, 4)
    expect(applyRounding(23.95, 'R90')).toBeCloseTo(23.90, 4)
    expect(applyRounding(24, 'R90')).toBeCloseTo(24.90, 4)
    expect(applyRounding(0.5, 'R90')).toBeCloseTo(0.90, 4)
  })

  it('R90 em valor já "redondo" (,90 exato) não muda', () => {
    expect(applyRounding(23.90, 'R90')).toBeCloseTo(23.90, 4)
  })

  it('R99 fixa a fração em ,99', () => {
    expect(applyRounding(23.45, 'R99')).toBeCloseTo(23.99, 4)
    expect(applyRounding(23.99, 'R99')).toBeCloseTo(23.99, 4)
    expect(applyRounding(24, 'R99')).toBeCloseTo(24.99, 4)
  })

  it('R00 fixa a fração em ,00 (equivale a truncar/piso pro inteiro)', () => {
    expect(applyRounding(23.45, 'R00')).toBeCloseTo(23.00, 4)
    expect(applyRounding(23.99, 'R00')).toBeCloseTo(23.00, 4)
    expect(applyRounding(24, 'R00')).toBeCloseTo(24.00, 4)
  })

  it('R00 em valor já inteiro não muda', () => {
    expect(applyRounding(50, 'R00')).toBeCloseTo(50, 4)
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
