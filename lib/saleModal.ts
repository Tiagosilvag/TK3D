import { resolveTieredPlatformFee, type PlatformFeeTier } from '@/lib/costing'

// Conta do lucro de UMA venda -- a MESMA função roda no modal (prévia ao vivo)
// e no servidor (o que fica gravado), então o lucro mostrado antes de
// registrar é exatamente o que fica depois.
export interface SaleCalcInput {
  quantity: number
  unitPrice: number
  productionCostPerUnit: number
  packagingLines: { quantityPerUnit: number; unitCost: number }[]
  feeTotal: number
  freight: number
  gift: { quantity: number; unitCost: number } | null
}

export interface SaleCalc {
  revenue: number
  production: number
  packaging: number
  fee: number
  freight: number
  gift: number
  profit: number
  // % da receita; null sem receita.
  marginPct: number | null
}

export function calculateSale(i: SaleCalcInput): SaleCalc {
  const revenue = i.quantity * i.unitPrice
  const production = i.quantity * i.productionCostPerUnit
  const packaging = i.packagingLines.reduce((sum, l) => sum + l.quantityPerUnit * i.quantity * l.unitCost, 0)
  const gift = i.gift ? i.gift.quantity * i.gift.unitCost : 0
  const profit = revenue - production - packaging - i.feeTotal - i.freight - gift
  return { revenue, production, packaging, fee: i.feeTotal, freight: i.freight, gift, profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : null }
}

export interface PlatformFeeConfig {
  feePercent: number
  feeFixed: number
  feeTiers: PlatformFeeTier[] | null
}

// Taxa automática por unidade, sobre o valor unitário (faixa certa pro preço
// digitado); Direta não tem taxa. Total = quantidade × taxa por unidade.
export function automaticFee(platform: PlatformFeeConfig | null, unitPrice: number, quantity: number): { perUnit: number; total: number; feePercent: number; feeFixed: number } {
  if (!platform || !(unitPrice > 0)) return { perUnit: 0, total: 0, feePercent: 0, feeFixed: 0 }
  const { feePercent, feeFixed } = platform.feeTiers && platform.feeTiers.length > 0 ? resolveTieredPlatformFee(platform.feeTiers, unitPrice) : { feePercent: platform.feePercent, feeFixed: platform.feeFixed }
  const perUnit = unitPrice * feePercent + feeFixed
  return { perUnit, total: perUnit * quantity, feePercent, feeFixed }
}

// Custo de produção SEM embalagem: finalCost tem a embalagem embutida (sob a
// flag includePackagingCost) e a taxa de falha por cima de tudo -- tira só a
// parcela da embalagem, com a mesma taxa de falha aplicada a ela.
export function productionCostExPackaging(
  breakdown: { finalCost: number; packagingCost: number },
  flags: { includePackagingCost: boolean; includeFailureRate: boolean; failureRatePercent: number },
): number {
  const packagingInFinal = flags.includePackagingCost ? breakdown.packagingCost * (1 + (flags.includeFailureRate ? flags.failureRatePercent : 0)) : 0
  return Math.max(0, breakdown.finalCost - packagingInFinal)
}
