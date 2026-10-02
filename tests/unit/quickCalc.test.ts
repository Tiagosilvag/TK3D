import { describe, expect, it } from 'vitest'
import { calculateQuickEstimate } from '@/lib/quickCalc'

describe('calculateQuickEstimate', () => {
  it('soma filamento + impressora + insumos/acessórios + mão de obra', () => {
    const result = calculateQuickEstimate({
      weightGrams: 10,
      filamentPricePerGram: 0.08,
      printTimeHours: 2,
      printerCostPerHour: 0.9,
      suppliesAndAccessoriesCost: 1.5,
      laborTimeHours: 5 / 60,
      laborCostPerHour: 10,
    })
    expect(result.filamentCost).toBeCloseTo(0.8, 4)
    expect(result.printerCost).toBeCloseTo(1.8, 4)
    expect(result.suppliesAndAccessoriesCost).toBe(1.5)
    expect(result.laborCost).toBeCloseTo(10 / 12, 4)
    expect(result.total).toBeCloseTo(0.8 + 1.8 + 1.5 + 10 / 12, 4)
  })

  it('sem filamento selecionado (pricePerGram=0) nem insumos/acessórios, soma só impressora + mão de obra', () => {
    const result = calculateQuickEstimate({
      weightGrams: 10,
      filamentPricePerGram: 0,
      printTimeHours: 1,
      printerCostPerHour: 0.5,
      suppliesAndAccessoriesCost: 0,
      laborTimeHours: 0,
      laborCostPerHour: 10,
    })
    expect(result.filamentCost).toBe(0)
    expect(result.suppliesAndAccessoriesCost).toBe(0)
    expect(result.laborCost).toBe(0)
    expect(result.total).toBeCloseTo(0.5, 4)
  })
})
