// Calculadora rápida de custo de produto: estimativa de custo com o mínimo
// de digitação possível (chips/steppers sobre dados já cadastrados), fora
// do fluxo normal de cadastro de produto (ProductForm/lib/costing.ts). Uma
// função pura própria (não reaproveita calculateProductCost) porque esta
// tela não tem os flags de composição de custo (Settings) nem desperdício —
// é sempre a soma direta de todos os termos, pensada pra responder rápido
// "quanto custa fazer isso", não pra virar o custo definitivo de um produto
// cadastrado (que continua passando por lib/costing.ts normalmente).
export interface QuickCalcInput {
  weightGrams: number
  filamentPricePerGram: number
  printTimeHours: number
  printerCostPerHour: number
  suppliesAndAccessoriesCost: number
  laborTimeHours: number
  laborCostPerHour: number
}

export interface QuickCalcBreakdown {
  filamentCost: number
  printerCost: number
  suppliesAndAccessoriesCost: number
  laborCost: number
  total: number
}

export function calculateQuickEstimate(input: QuickCalcInput): QuickCalcBreakdown {
  const filamentCost = input.weightGrams * input.filamentPricePerGram
  const printerCost = input.printTimeHours * input.printerCostPerHour
  const laborCost = input.laborTimeHours * input.laborCostPerHour
  return {
    filamentCost,
    printerCost,
    suppliesAndAccessoriesCost: input.suppliesAndAccessoriesCost,
    laborCost,
    total: filamentCost + printerCost + input.suppliesAndAccessoriesCost + laborCost,
  }
}
