import { describe, it, expect } from 'vitest'
import {
  calculatePrinterDepreciationCostPerHour,
  calculatePrinterMaintenanceCostPerHour,
  calculateFilamentPricePerKg,
  calculateFilamentPricePerGram,
  calculateProductCost,
  calculateWasteCost,
  getStockStatus,
  getStockStatusWithThresholds,
  calculateWeightedAverageCost,
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

// Accessory/Supply stock status (task-3 brief): the spec is explicit that
// these use Settings.stockLowThresholdPercent/stockCriticalThresholdPercent
// instead of Filament's hardcoded 30%/10% -- "NÃO reusar a versão fixa
// 30/10 do Filament sem parametrizar, ou os dois sistemas ficam acoplados
// incorretamente". Thresholds are passed as fractions (0-1), matching how
// Settings stores every percentage in this app; percentRemaining is 0-100,
// matching getStockStatus's existing convention.
describe('getStockStatusWithThresholds', () => {
  it('com os limiares default de Settings (0.30/0.10), reproduz exatamente getStockStatus', () => {
    for (const p of [100, 31, 30, 20, 10, 9.9, 0.1, 0, -5]) {
      expect(getStockStatusWithThresholds(p, 0.30, 0.10)).toEqual(getStockStatus(p))
    }
  })

  it('limiares diferentes (0.50/0.20) mudam o resultado -- prova que não é o 30/10 fixo do Filament', () => {
    // 40% estaria "em estoque" pelo Filament (>30%), mas aqui, com low=50%,
    // cai em "estoque baixo".
    expect(getStockStatusWithThresholds(40, 0.50, 0.20)).toEqual({ emoji: '🟡', label: 'Estoque baixo' })
    // 15% estaria "estoque baixo" pelo Filament (10-30%), mas aqui, com
    // critical=20%, cai em "estoque crítico".
    expect(getStockStatusWithThresholds(15, 0.50, 0.20)).toEqual({ emoji: '🔴', label: 'Estoque crítico' })
    // acima do low threshold (50%) continua "em estoque".
    expect(getStockStatusWithThresholds(51, 0.50, 0.20)).toEqual({ emoji: '🟢', label: 'Em estoque' })
  })

  it('0% ou menos -> esgotado, independente dos limiares', () => {
    expect(getStockStatusWithThresholds(0, 0.50, 0.20)).toEqual({ emoji: '⚫', label: 'Esgotado' })
    expect(getStockStatusWithThresholds(-1, 0.05, 0.01)).toEqual({ emoji: '⚫', label: 'Esgotado' })
  })
})

// Weighted-average purchase cost (task-3 brief §Accessory, also reused by
// Supply in task 4): newAvgCost = (currentStock*avgUnitCost + totalCost) /
// (currentStock+quantity) -- the brief's "forma mais simples" that avoids
// dividing then re-multiplying purchaseTotalCost/purchaseQuantity*purchaseQuantity.
describe('calculateWeightedAverageCost', () => {
  it('primeira compra (estoque zerado): resultado é só totalCost/quantity', () => {
    // cadastro de um Accessory novo = a primeira compra (brief): currentStock
    // e avgUnitCost nascem zerados, então a média ponderada colapsa para o
    // custo unitário simples da própria compra.
    // hand-compute: (0*0 + 16) / (0 + 20) = 16/20 = 0.8
    const result = calculateWeightedAverageCost({
      currentStock: 0,
      avgUnitCost: 0,
      purchaseQuantity: 20,
      purchaseTotalCost: 16,
    })
    expect(result).toBeCloseTo(0.8, 6)
  })

  it('segunda compra recalcula a média ponderada corretamente (hand-computed)', () => {
    // Estoque atual: 100 unidades a R$0,50/un (valor em estoque = R$50).
    // Nova compra: 50 unidades por R$30 no total (R$0,60/un).
    // hand-compute: (100*0.5 + 30) / (100+50) = (50+30)/150 = 80/150 = 0.5333...
    const result = calculateWeightedAverageCost({
      currentStock: 100,
      avgUnitCost: 0.5,
      purchaseQuantity: 50,
      purchaseTotalCost: 30,
    })
    expect(result).toBeCloseTo(0.533333, 6)
  })

  it('terceira compra a um preço mais barato puxa a média pra baixo (hand-computed)', () => {
    // Continuando do estado após a 2a compra: 150 unidades a R$0,5333.../un
    // (valor em estoque ~= R$80). Nova compra: 150 unidades por R$45 no
    // total (R$0,30/un, mais barato que a média atual).
    // hand-compute: (150*0.533333... + 45) / (150+150) = (80 + 45)/300 = 125/300 = 0.41666...
    const result = calculateWeightedAverageCost({
      currentStock: 150,
      avgUnitCost: 80 / 150,
      purchaseQuantity: 150,
      purchaseTotalCost: 45,
    })
    expect(result).toBeCloseTo(0.416667, 6)
  })

  it('compra a um preço mais caro puxa a média pra cima (hand-computed)', () => {
    // Estoque: 10 unidades a R$1,00/un (valor R$10). Compra: 10 unidades por
    // R$30 (R$3,00/un, bem mais caro).
    // hand-compute: (10*1 + 30) / (10+10) = 40/20 = 2.0
    const result = calculateWeightedAverageCost({
      currentStock: 10,
      avgUnitCost: 1,
      purchaseQuantity: 10,
      purchaseTotalCost: 30,
    })
    expect(result).toBeCloseTo(2.0, 6)
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
