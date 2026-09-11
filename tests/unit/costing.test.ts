import { describe, it, expect } from 'vitest'
import {
  calculatePrinterDepreciationCostPerHour,
  calculateFilamentPricePerKg,
  calculateFilamentPricePerGram,
  calculateProductCost,
  calculateWasteCost,
  getStockStatus,
  getStockStatusWithThresholds,
  calculateStockReferenceQuantity,
  calculateStockPercentRemaining,
  calculateWeightedAverageCost,
  applyRounding,
  sumUsageCost,
  buildProductionCostSnapshot,
  buildSaleCostSnapshot,
  simulateProductPrice,
  sumProductPartsCost,
  calculateCompositeProductCost,
  type ProductionCostSnapshotInput,
  type ProductCostBreakdown,
  type ProductPartCostInput,
} from '@/lib/costing'

describe('calculatePrinterDepreciationCostPerHour (no maintenance folded in)', () => {
  it('Bambu Lab A1 Mini: 3000 / 10000h', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3000, depreciationHours: 10000 })).toBeCloseTo(0.30, 4)
  })
  it('Anycubic Kobra X: 3600 / 10000h', () => {
    expect(calculatePrinterDepreciationCostPerHour({ purchasePrice: 3600, depreciationHours: 10000 })).toBeCloseTo(0.36, 4)
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

// Fix 2 (task-10 brief): percentRemaining used to divide currentStock by
// "total ever purchased" (sum of every AccessoryPurchase/SupplyPurchase
// ever recorded), which decays toward zero for any item restocked many
// times regardless of its real health -- a fast-turnover item that gets
// restocked often looks progressively worse the longer it's been tracked,
// even though it's never actually running low right after each restock.
//
// Chosen fix (documented in the task-10 report): replace "total já
// comprado" with "média das últimas N compras" as the 100% reference level
// -- this is the brief's own second option, picked over "abandon percentage,
// use only an absolute threshold" because (a) it keeps the existing
// percentage-based UI/status functions unchanged (getStockStatusWithThresholds
// still takes a 0-100 percentRemaining, no call-site rewiring needed beyond
// how that percentage is computed) and (b) it doesn't require a new
// per-item "standard restock size" field on the schema -- the purchase
// history already loaded by both pages (ordered by purchaseDate desc) is
// enough. A fast-turnover item's reference level tracks its OWN typical
// restock size, so right after a normal-sized restock it reads close to
// 100% no matter how many restocks came before it.
describe('calculateStockReferenceQuantity', () => {
  it('média das últimas N (padrão 5) quantidades, mais recente primeiro', () => {
    // 5 compras de 100 cada -> referência = 100.
    expect(calculateStockReferenceQuantity([100, 100, 100, 100, 100])).toBeCloseTo(100, 6)
  })

  it('ignora compras mais antigas que as últimas N', () => {
    // 7 compras (mais recente primeiro); só as 5 primeiras (100 cada) contam
    // -- as duas últimas (10 cada, mais antigas) são ignoradas.
    const quantities = [100, 100, 100, 100, 100, 10, 10]
    expect(calculateStockReferenceQuantity(quantities, 5)).toBeCloseTo(100, 6)
  })

  it('usa todas as compras disponíveis quando há menos que N', () => {
    expect(calculateStockReferenceQuantity([40, 60], 5)).toBeCloseTo(50, 6)
  })

  it('sample size customizável', () => {
    expect(calculateStockReferenceQuantity([100, 100, 10, 10], 2)).toBeCloseTo(100, 6)
  })

  it('lista vazia -> referência 0 (sem histórico de compra)', () => {
    expect(calculateStockReferenceQuantity([])).toBe(0)
  })
})

describe('calculateStockPercentRemaining', () => {
  it('currentStock sobre a referência das últimas compras, como percentual', () => {
    expect(calculateStockPercentRemaining(90, 100)).toBeCloseTo(90, 6)
    expect(calculateStockPercentRemaining(50, 100)).toBeCloseTo(50, 6)
  })

  it('pode passar de 100% (acabou de repor bem mais que o costume) -- não é um bug, só reflete a saúde real do estoque', () => {
    expect(calculateStockPercentRemaining(300, 100)).toBeCloseTo(300, 6)
  })

  it('referência zero (sem histórico): 0% se esgotado, 100% se há algo em estoque sem como comparar', () => {
    expect(calculateStockPercentRemaining(0, 0)).toBe(0)
    expect(calculateStockPercentRemaining(5, 0)).toBe(100)
  })

  it('cenário de giro rápido (o bug do Fix 2): item restocado muitas vezes não cai artificialmente pra crítico', () => {
    // Item com giro rápido: 20 compras de 100 unidades já feitas ao longo do
    // tempo (2000 total já comprado) -- mas o saldo atual (90, logo após a
    // 20a reposição) é saudável relativo ao padrão de reposição desse item.
    const purchaseHistoryDesc = Array(20).fill(100) // mais recente primeiro
    const currentStock = 90

    // Comportamento ANTIGO (não exportado, calculado aqui só pra contraste):
    // 90 / (20*100) * 100 = 4.5% -> cairia em "crítico" (< 10%), errado.
    const oldPercent = (currentStock / (purchaseHistoryDesc.reduce((s, q) => s + q, 0))) * 100
    expect(oldPercent).toBeCloseTo(4.5, 4)
    expect(getStockStatusWithThresholds(oldPercent, 0.30, 0.10).label).toBe('Estoque crítico')

    // Comportamento NOVO: referência = média das últimas 5 compras (100),
    // percentRemaining = 90/100*100 = 90% -> "Em estoque", correto.
    const referenceQuantity = calculateStockReferenceQuantity(purchaseHistoryDesc)
    const newPercent = calculateStockPercentRemaining(currentStock, referenceQuantity)
    expect(newPercent).toBeCloseTo(90, 6)
    expect(getStockStatusWithThresholds(newPercent, 0.30, 0.10).label).toBe('Em estoque')
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
      printerEnergyCostPerKwh: 1,
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
      printerEnergyCostPerKwh: 1,
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
      printerEnergyCostPerKwh: 1,
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

// Ajuste "peça multi-filamento": uma peça pode ter mais de 1 componente de
// filamento (impressão multi-material simultânea) -- filamentCost passa a
// somar weightGrams*pricePerKg de CADA componente antes de multiplicar por
// quantityPerUnit.
describe('sumProductPartsCost (peça multi-filamento)', () => {
  it('peça de um único componente de filamento (caso comum)', () => {
    const part: ProductPartCostInput = {
      quantityPerUnit: 1,
      filamentComponents: [{ weightGrams: 30, filamentPricePerKg: 80 }],
      printTimeHours: 2,
      printerAvgPowerConsumptionKwh: 0.27,
      printerEnergyCostPerKwh: 1,
      printerDepreciationCostPerHour: 0.36,
      printerMaintenanceCostPerHour: 0.18,
    }
    const result = sumProductPartsCost([part])
    // filamentCost = 30 * (80/1000) = 2.4
    expect(result.filamentCost).toBeCloseTo(2.4, 4)
    expect(result.electricityCost).toBeCloseTo(0.54, 4)
    expect(result.printerCost).toBeCloseTo(0.72, 4)
    expect(result.maintenanceCost).toBeCloseTo(0.36, 4)
  })

  it('peça com 3 componentes de filamento simultâneos (preto+verde+branco)', () => {
    const part: ProductPartCostInput = {
      quantityPerUnit: 1,
      filamentComponents: [
        { weightGrams: 15, filamentPricePerKg: 80 },
        { weightGrams: 8, filamentPricePerKg: 100 },
        { weightGrams: 3, filamentPricePerKg: 120 },
      ],
      printTimeHours: 2,
      printerAvgPowerConsumptionKwh: 0.27,
      printerEnergyCostPerKwh: 1,
      printerDepreciationCostPerHour: 0.36,
      printerMaintenanceCostPerHour: 0.18,
    }
    const result = sumProductPartsCost([part])
    // filamentCost = 15*(80/1000) + 8*(100/1000) + 3*(120/1000) = 1.2 + 0.8 + 0.36 = 2.36
    expect(result.filamentCost).toBeCloseTo(2.36, 4)
    // Termos por impressora/energia não dependem de filamento -- inalterados.
    expect(result.electricityCost).toBeCloseTo(0.54, 4)
  })

  it('multiplica o custo de filamento da peça (todos os componentes) por quantityPerUnit', () => {
    const part: ProductPartCostInput = {
      quantityPerUnit: 3,
      filamentComponents: [
        { weightGrams: 15, filamentPricePerKg: 80 },
        { weightGrams: 8, filamentPricePerKg: 100 },
      ],
      printTimeHours: 1,
      printerAvgPowerConsumptionKwh: 0.1,
      printerEnergyCostPerKwh: 1,
      printerDepreciationCostPerHour: 0.1,
      printerMaintenanceCostPerHour: 0.1,
    }
    const result = sumProductPartsCost([part])
    // (1.2 + 0.8) * 3 = 6.0
    expect(result.filamentCost).toBeCloseTo(6.0, 4)
  })

  it('soma corretamente entre múltiplas peças, cada uma com sua própria receita', () => {
    const parts: ProductPartCostInput[] = [
      { quantityPerUnit: 1, filamentComponents: [{ weightGrams: 10, filamentPricePerKg: 80 }], printTimeHours: 1, printerAvgPowerConsumptionKwh: 0, printerEnergyCostPerKwh: 1, printerDepreciationCostPerHour: 0, printerMaintenanceCostPerHour: 0 },
      { quantityPerUnit: 2, filamentComponents: [{ weightGrams: 5, filamentPricePerKg: 80 }, { weightGrams: 5, filamentPricePerKg: 80 }], printTimeHours: 1, printerAvgPowerConsumptionKwh: 0, printerEnergyCostPerKwh: 1, printerDepreciationCostPerHour: 0, printerMaintenanceCostPerHour: 0 },
    ]
    const result = sumProductPartsCost(parts)
    // peça 1: 10*0.08 = 0.8 ; peça 2: (5*0.08 + 5*0.08) * 2 = 0.8 * 2 = 1.6 -> total 2.4
    expect(result.filamentCost).toBeCloseTo(2.4, 4)
  })
})

describe('calculateCompositeProductCost (peça multi-filamento, integração)', () => {
  const settings = {
    laborCostPerHour: 10,
    failureRatePercent: 0.10,
    marketplaceFeePercent: 0.20,
    taxPercent: 0.055,
    marketplaceFixedFee: 4,
    defaultMarkup: 2,
  }
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

  it('produto composto com uma peça multi-filamento soma o custo de todas as cores', () => {
    const result = calculateCompositeProductCost(
      {
        parts: [
          {
            quantityPerUnit: 1,
            filamentComponents: [
              { weightGrams: 15, filamentPricePerKg: 80 },
              { weightGrams: 8, filamentPricePerKg: 100 },
            ],
            printTimeHours: 2,
            printerAvgPowerConsumptionKwh: 0.27,
            printerEnergyCostPerKwh: 1,
            printerDepreciationCostPerHour: 0.36,
            printerMaintenanceCostPerHour: 0.18,
          },
        ],
        laborTimeHours: 0,
        suppliesCost: 0,
        packagingCost: 0,
        accessoryCost: 0,
        ...allIncludeTrue,
      },
      settings,
    )
    // filamentCost = 15*0.08 + 8*0.1 = 1.2 + 0.8 = 2.0
    expect(result.filamentCost).toBeCloseTo(2.0, 4)
  })
})

describe('calculateProductCost — flags include* (Configurações §3)', () => {
  const settings = {
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
    printerEnergyCostPerKwh: 1,
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

  it('CUSTOM fixa a fração nos dígitos informados (customCents)', () => {
    expect(applyRounding(23.45, 'CUSTOM', 50)).toBeCloseTo(23.50, 4)
    expect(applyRounding(23.95, 'CUSTOM', 50)).toBeCloseTo(23.50, 4)
    expect(applyRounding(24, 'CUSTOM', 0)).toBeCloseTo(24.00, 4)
    expect(applyRounding(24, 'CUSTOM', 99)).toBeCloseTo(24.99, 4)
  })

  it('CUSTOM sem customCents informado trata como ,00 (mesmo comportamento de R00)', () => {
    expect(applyRounding(23.45, 'CUSTOM')).toBeCloseTo(23.00, 4)
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

describe('sumUsageCost (spec §2, task-5 brief — soma quantity * avgUnitCost por linha de uso)', () => {
  it('soma quantity * avgUnitCost em várias linhas', () => {
    const result = sumUsageCost([
      { quantity: 2, avgUnitCost: 0.05 },
      { quantity: 1, avgUnitCost: 0.3 },
      { quantity: 3, avgUnitCost: 0.1 },
    ])
    // 0.10 + 0.30 + 0.30 = 0.70
    expect(result).toBeCloseTo(0.70, 4)
  })

  it('retorna 0 pra lista vazia (produto sem esse recurso)', () => {
    expect(sumUsageCost([])).toBe(0)
  })

  it('funciona com uma única linha', () => {
    expect(sumUsageCost([{ quantity: 4, avgUnitCost: 0.25 }])).toBeCloseTo(1, 4)
  })
})

describe('buildProductionCostSnapshot (spec §4/§5, task-5 brief)', () => {
  const settings = {
    laborCostPerHour: 10,
    failureRatePercent: 0.10,
    marketplaceFeePercent: 0.20,
    taxPercent: 0.055,
    marketplaceFixedFee: 4,
    defaultMarkup: 2,
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

  // Same per-unit fixture as the "flags include*" describe block above
  // (filamentCost 2.4, electricityCost 0.54, printerCost 0.72,
  // maintenanceCost 0.36, laborCost 0.5, suppliesCost 0.3, packagingCost
  // 0.2, accessoryCost 0.15 -> subtotal 5.17 -> finalCost 5.687), so the
  // per-unit portion of the snapshot can be cross-checked directly against
  // calculateProductCost's own output for the exact same numbers.
  const baseInput: ProductionCostSnapshotInput = {
    ...allTrue,
    filamentId: 'fil1',
    weightGrams: 30,
    printTimeHours: 2,
    laborTimeHours: 0.05,
    filamentPricePerKg: 80,
    printerAvgPowerConsumptionKwh: 0.27,
    printerEnergyCostPerKwh: 1,
    printerDepreciationCostPerHour: 0.36,
    printerMaintenanceCostPerHour: 0.18,
    packagingItemId: 'pkg1',
    packagingCost: 0.2,
    accessoryUsages: [
      { accessoryId: 'acc1', quantity: 1, avgUnitCost: 0.10 },
      { accessoryId: 'acc2', quantity: 1, avgUnitCost: 0.05 },
    ],
    supplyUsages: [{ supplyId: 'sup1', quantity: 2, avgUnitCost: 0.15 }],
    quantityPlanned: 10,
    quantitySuccess: 8,
    quantityFailed: 2,
    gramsUsed: 300,
    gramsWasted: 20,
    timeWastedHours: 0.5,
  }

  it('unitCost bate exatamente com calculateProductCost pros mesmos insumos', () => {
    const snapshot = buildProductionCostSnapshot(baseInput, settings)
    // sumUsageCost(accessoryUsages) instead of the literal 0.15 -- both sides
    // must add the two accessory rows in the exact same order, otherwise
    // this comparison is just observing binary floating-point noise
    // (0.10+0.05 vs 0.15 differ in the last bit) rather than a real bug.
    const expectedUnitCost = calculateProductCost(
      {
        ...allTrue,
        weightGrams: 30,
        printTimeHours: 2,
        laborTimeHours: 0.05,
        filamentPricePerKg: 80,
        printerAvgPowerConsumptionKwh: 0.27,
        printerEnergyCostPerKwh: 1,
        printerDepreciationCostPerHour: 0.36,
        printerMaintenanceCostPerHour: 0.18,
        suppliesCost: sumUsageCost(baseInput.supplyUsages),
        packagingCost: 0.2,
        accessoryCost: sumUsageCost(baseInput.accessoryUsages),
      },
      settings,
    )
    expect(snapshot.unitCost).toEqual(expectedUnitCost)
  })

  it('wasteCost bate com calculateWasteCost pros mesmos parâmetros de desperdício', () => {
    const snapshot = buildProductionCostSnapshot(baseInput, settings)
    const expectedWasteCost = calculateWasteCost({
      gramsWasted: 20,
      timeWastedHours: 0.5,
      filamentPricePerKg: 80,
      printerDepreciationCostPerHour: 0.36,
      printerMaintenanceCostPerHour: 0.18,
      printerAvgPowerConsumptionKwh: 0.27,
      energyCostPerKwh: 1,
    })
    expect(snapshot.wasteCost).toBeCloseTo(expectedWasteCost, 6)
    expect(snapshot.wasteCost).toBeCloseTo(2.005, 3)
  })

  it('total = unitCost.finalCost * quantitySuccess + wasteCost (custo real incorrido pela produção inteira)', () => {
    const snapshot = buildProductionCostSnapshot(baseInput, settings)
    // finalCost 5.687 * 8 sucesso = 45.496; + wasteCost 2.005 = 47.501
    expect(snapshot.total).toBeCloseTo(45.496 + 2.005, 3)
    expect(snapshot.total).toBeCloseTo(snapshot.unitCost.finalCost * 8 + snapshot.wasteCost, 6)
  })

  it('preserva quantityPlanned/quantitySuccess/quantityFailed no snapshot', () => {
    const snapshot = buildProductionCostSnapshot(baseInput, settings)
    expect(snapshot.quantityPlanned).toBe(10)
    expect(snapshot.quantitySuccess).toBe(8)
    expect(snapshot.quantityFailed).toBe(2)
  })

  it('consumedResources.filament registra id + gramas usadas/desperdiçadas', () => {
    const snapshot = buildProductionCostSnapshot(baseInput, settings)
    expect(snapshot.consumedResources.filament).toEqual({
      filamentId: 'fil1',
      gramsUsed: 300,
      gramsWasted: 20,
    })
  })

  it('consumedResources.accessories multiplica quantity por quantitySuccess (só unidades com sucesso consomem acessório, spec §5.1) e preserva o custo unitário vigente', () => {
    const snapshot = buildProductionCostSnapshot(baseInput, settings)
    expect(snapshot.consumedResources.accessories).toEqual([
      { accessoryId: 'acc1', quantityPerUnit: 1, quantityConsumed: 8, unitCost: 0.10 },
      { accessoryId: 'acc2', quantityPerUnit: 1, quantityConsumed: 8, unitCost: 0.05 },
    ])
  })

  it('consumedResources.supplies multiplica quantity por quantitySuccess', () => {
    const snapshot = buildProductionCostSnapshot(baseInput, settings)
    expect(snapshot.consumedResources.supplies).toEqual([
      { supplyId: 'sup1', quantityPerUnit: 2, quantityConsumed: 16, unitCost: 0.15 },
    ])
  })

  it('consumedResources.packaging registra 1 unidade de embalagem por peça bem-sucedida', () => {
    const snapshot = buildProductionCostSnapshot(baseInput, settings)
    expect(snapshot.consumedResources.packaging).toEqual({
      packagingItemId: 'pkg1',
      quantityConsumed: 8,
      unitCost: 0.2,
    })
  })

  it('consumedResources.packaging é null quando o produto não usa embalagem', () => {
    const snapshot = buildProductionCostSnapshot(
      { ...baseInput, packagingItemId: null, packagingCost: 0 },
      settings,
    )
    expect(snapshot.consumedResources.packaging).toBeNull()
  })

  it('consumedResources.accessories/supplies ficam vazios quando o produto não usa nenhum', () => {
    const snapshot = buildProductionCostSnapshot(
      { ...baseInput, accessoryUsages: [], supplyUsages: [] },
      settings,
    )
    expect(snapshot.consumedResources.accessories).toEqual([])
    expect(snapshot.consumedResources.supplies).toEqual([])
  })

  it('desligar includeAccessoriesCost muda o total (via unitCost.finalCost) mas NÃO reduz a quantidade fisicamente consumida — a peça continua gastando o acessório mesmo que seu custo esteja marcado como não contabilizado', () => {
    const snapshot = buildProductionCostSnapshot(
      { ...baseInput, includeAccessoriesCost: false },
      settings,
    )
    expect(snapshot.unitCost.subtotal).toBeCloseTo(5.17 - 0.15, 4)
    expect(snapshot.consumedResources.accessories).toEqual([
      { accessoryId: 'acc1', quantityPerUnit: 1, quantityConsumed: 8, unitCost: 0.10 },
      { accessoryId: 'acc2', quantityPerUnit: 1, quantityConsumed: 8, unitCost: 0.05 },
    ])
  })

  it('é uma função pura: mesma entrada sempre produz o mesmo snapshot (serializável em JSON, sem instâncias/timestamps escondidos)', () => {
    const a = buildProductionCostSnapshot(baseInput, settings)
    const b = buildProductionCostSnapshot(baseInput, settings)
    expect(a).toEqual(b)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })
})

// Sale cost snapshot (task-10 brief, new feature): mirrors
// buildProductionCostSnapshot's {unitCost, total} shape above -- a Sale has
// no waste/quantityFailed concept of its own, so `total` here is simply
// unitCost.finalCost * quantity, the total cost basis the sale represents.
describe('buildSaleCostSnapshot (task-10 brief, new feature -- Sale cost snapshot)', () => {
  const breakdown: ProductCostBreakdown = {
    filamentCost: 3,
    electricityCost: 0.5,
    printerCost: 0.6,
    maintenanceCost: 0.1,
    laborCost: 2,
    suppliesCost: 0.2,
    packagingCost: 0.3,
    accessoryCost: 0.4,
    failureRateCost: 0.71,
    subtotal: 7.1,
    finalCost: 7.81,
    suggestedPrice: 15.62,
    marketplacePrice: 22,
  }

  it('total = unitCost.finalCost * quantity (hand-computed)', () => {
    const snapshot = buildSaleCostSnapshot(breakdown, 3)
    expect(snapshot.quantity).toBe(3)
    expect(snapshot.unitCost).toEqual(breakdown)
    expect(snapshot.total).toBeCloseTo(7.81 * 3, 6)
  })

  it('quantidade 1: total == finalCost', () => {
    const snapshot = buildSaleCostSnapshot(breakdown, 1)
    expect(snapshot.total).toBeCloseTo(7.81, 6)
  })

  it('é uma função pura, serializável em JSON', () => {
    const a = buildSaleCostSnapshot(breakdown, 5)
    const b = buildSaleCostSnapshot(breakdown, 5)
    expect(a).toEqual(b)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
  })
})

// "Simulação de preço" (task-6 brief, spec §2): a client-side-only pricing
// preview that layers Settings' desiredMarginPercent/defaultDiscountPercent
// on top of the existing markup-based suggestedPrice/marketplacePrice
// formula from calculateProductCost, which stays untouched (still
// markup-only, still the persisted Task-5 breakdown). This is the ONLY
// place margin/discount currently affect a price:
//   1. markup-based price = finalCost * markup (same shape as
//      calculateProductCost.suggestedPrice)
//   2. margin-based floor = finalCost / (1 - marginPercent) -- guarantees
//      the suggested price never implies less than the desired profit
//      margin, even if markup alone would undercut it
//   3. suggestedPrice = max(1, 2), with a promotional discountPercent
//      applied on top
//   4. marketplacePrice reuses calculateProductCost's exact fee/tax/fixed-fee
//      shape, applied to the (possibly discounted) suggestedPrice above
describe('simulateProductPrice (task-6 brief — Simulação de preço)', () => {
  const marketplaceInput = {
    marketplaceFeePercent: 0.20,
    taxPercent: 0.055,
    marketplaceFixedFee: 4,
  }

  it('com markup dominante (markup*finalCost > piso de margem) e desconto zero, reproduz suggestedPrice/marketplacePrice de calculateProductCost', () => {
    // finalCost 7.502, markup 2 -> markupPrice 15.004; margin 0.30 ->
    // floor = 7.502/0.7 = 10.717... < 15.004, então o markup vence e o
    // desconto zero não altera nada -- deve bater com o teste
    // "marketplacePrice a partir de um suggestedPrice conhecido" acima.
    const result = simulateProductPrice({
      finalCost: 7.502,
      markup: 2,
      marginPercent: 0.30,
      discountPercent: 0,
      ...marketplaceInput,
    })
    expect(result.suggestedPrice).toBeCloseTo(15.004, 3)
    expect(result.marketplacePrice).toBeCloseTo(24.1396, 2)
  })

  it('quando o piso de margem é maior que o preço via markup, a margem prevalece', () => {
    // finalCost 10, markup 1.2 -> markupPrice 12; margin 0.5 -> floor = 10/0.5 = 20
    const result = simulateProductPrice({
      finalCost: 10,
      markup: 1.2,
      marginPercent: 0.5,
      discountPercent: 0,
      ...marketplaceInput,
    })
    expect(result.suggestedPrice).toBeCloseTo(20, 4)
  })

  it('desconto reduz o suggestedPrice final (aplicado por cima do preço base já escolhido)', () => {
    // finalCost 10, markup 2 -> markupPrice 20 (vence a margem de 0.30,
    // cujo piso é 10/0.7 ≈ 14.29); desconto 10% -> 20*0.9 = 18
    const result = simulateProductPrice({
      finalCost: 10,
      markup: 2,
      marginPercent: 0.30,
      discountPercent: 0.10,
      ...marketplaceInput,
    })
    expect(result.suggestedPrice).toBeCloseTo(18, 4)
  })

  it('marketplacePrice é sempre calculado a partir do suggestedPrice (já com desconto), com o mesmo formato de fee/tax/fixedFee', () => {
    const result = simulateProductPrice({
      finalCost: 10,
      markup: 2,
      marginPercent: 0.30,
      discountPercent: 0.10,
      ...marketplaceInput,
    })
    // suggestedPrice 18 -> marketplacePrice = 18 / (1 - 0.20 - 0.055) + 4
    expect(result.marketplacePrice).toBeCloseTo(18 / 0.745 + 4, 4)
  })
})
