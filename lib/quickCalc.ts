// Calculadora rápida de custo de produto: estimativa de custo com o mínimo
// de digitação possível (chips/steppers sobre dados já cadastrados), fora
// do fluxo normal de cadastro de produto (ProductForm/lib/costing.ts). Uma
// função pura própria (não reaproveita calculateProductCost) porque esta
// tela não tem os flags de composição de custo (Settings) nem desperdício —
// é sempre a soma direta de todos os termos, pensada pra responder rápido
// "quanto custa fazer isso", não pra virar o custo definitivo de um produto
// cadastrado (que continua passando por lib/costing.ts normalmente).
// Melhoria "Calculadora rápida multi-filamento": impressão multi-material
// (ex.: corpo preto 15g + detalhe verde 8g na mesma peça, ver ProductPart/
// ProductPartFilament no schema) precisa de 1+ componentes de filamento, não
// só um peso/preço único -- filamentCost vira a soma de cada componente.
export interface QuickCalcFilamentComponent {
  weightGrams: number
  pricePerGram: number
}

export interface QuickCalcInput {
  filamentComponents: QuickCalcFilamentComponent[]
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
  const filamentCost = input.filamentComponents.reduce((sum, c) => sum + c.weightGrams * c.pricePerGram, 0)
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
