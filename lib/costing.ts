export interface PrinterDepreciationInput {
  purchasePrice: number
  depreciationHours: number
}

export function calculatePrinterDepreciationCostPerHour(input: PrinterDepreciationInput): number {
  return input.purchasePrice / input.depreciationHours
}

// Melhoria "Impressoras": manutenção deixou de ser uma fórmula genérica
// (purchasePrice * Settings.annualMaintenancePercent / Settings.annualUsageHours,
// igual pra toda impressora) e virou input direto por impressora
// (Printer.maintenanceCostPerHour) -- não há mais nada a "calcular" aqui,
// cada chamador lê o valor já pronto direto do Printer. Função removida.

export interface FilamentPriceInput {
  spoolPrice: number
  spoolWeightKg: number
}

export function calculateFilamentPricePerKg(input: FilamentPriceInput): number {
  return input.spoolPrice / input.spoolWeightKg
}

export function calculateFilamentPricePerGram(input: FilamentPriceInput): number {
  return calculateFilamentPricePerKg(input) / 1000
}

export interface StockStatus {
  emoji: string
  label: string
}

// Thresholds from the spec (§3.3): >30% em estoque, 10-30% baixo, 0-10% (exclusive
// of 0) crítico, <=0% esgotado.
export function getStockStatus(percentRemaining: number): StockStatus {
  if (percentRemaining <= 0) return { emoji: '⚫', label: 'Esgotado' }
  if (percentRemaining < 10) return { emoji: '🔴', label: 'Estoque crítico' }
  if (percentRemaining <= 30) return { emoji: '🟡', label: 'Estoque baixo' }
  return { emoji: '🟢', label: 'Em estoque' }
}

// Melhorias "Embalagens": status de estoque por limiar ABSOLUTO
// (PackagingItem.minStock, unidades), não percentual como Filament (fixo
// 30/10) ou Accessory/Supply (Settings.stockLow/CriticalThresholdPercent)
// -- cada embalagem define seu próprio "abaixo de quanto é pouco" em
// unidades direto, sem depender de histórico de compras pra calcular uma
// referência de 100%.
export function getPackagingStockStatus(currentStock: number, minStock: number): StockStatus {
  if (currentStock <= 0) return { emoji: '⚫', label: 'Esgotado' }
  if (currentStock <= minStock) return { emoji: '🔴', label: 'Estoque baixo' }
  return { emoji: '🟢', label: 'Em estoque' }
}

// Accessory/Supply stock status (spec §1.1/§1.3, task-3 brief): same shape
// as getStockStatus above, but with the low/critical thresholds passed in
// (as fractions, 0-1 -- same convention Settings stores every percentage
// in) instead of Filament's hardcoded 30%/10%. Accessories and Insumos are
// a deliberately independent, configurable stock system (Settings.
// stockLowThresholdPercent/stockCriticalThresholdPercent) -- Filament's
// getStockStatus above is untouched on purpose, to avoid regressing an
// already-tested, in-production threshold.
export function getStockStatusWithThresholds(
  percentRemaining: number,
  lowThresholdPercent: number,
  criticalThresholdPercent: number,
): StockStatus {
  if (percentRemaining <= 0) return { emoji: '⚫', label: 'Esgotado' }
  if (percentRemaining < criticalThresholdPercent * 100) return { emoji: '🔴', label: 'Estoque crítico' }
  if (percentRemaining <= lowThresholdPercent * 100) return { emoji: '🟡', label: 'Estoque baixo' }
  return { emoji: '🟢', label: 'Em estoque' }
}

// Fix 2 (task-10 brief): percentRemaining for Accessory/Supply used to
// divide currentStock by "total já comprado" (sum of EVERY purchase ever
// recorded) -- correct-looking at first ("quanto sobrou do total"), but it
// decays toward zero for any item that gets restocked often, regardless of
// whether it's actually running low. A fast-turnover item restocked weekly
// for a year looks progressively more "crítico" over time even right after
// a normal-sized restock, purely because the denominator keeps growing.
//
// Chosen fix: replace "total já comprado" with "média das últimas N
// compras" as the 100%-reference stock level. This was the brief's own
// second proposed option, picked over "drop percentage, use only an
// absolute currentStock threshold" for two reasons: (1) it keeps
// getStockStatusWithThresholds and every percentage-based UI element
// unchanged -- only how percentRemaining itself is computed changes; (2) it
// needs no new schema field (no per-item "standard restock size" like
// Filament's initialStockGrams) -- the purchase history both pages already
// load (ordered by purchaseDate desc) is enough. A fast-turnover item's
// reference level tracks its OWN typical restock size, so right after a
// normal restock it reads close to 100% no matter how many restocks came
// before it -- exactly the property the old calculation lacked.
export function calculateStockReferenceQuantity(recentPurchaseQuantitiesDesc: number[], sampleSize = 5): number {
  const sample = recentPurchaseQuantitiesDesc.slice(0, sampleSize)
  if (sample.length === 0) return 0
  return sample.reduce((sum, q) => sum + q, 0) / sample.length
}

// referenceQuantity <= 0 only happens when there's no purchase history at
// all (impossible in practice -- creating an Accessory/Supply IS its first
// purchase) or every recent purchase was somehow zero -- treated as "can't
// judge health from history", so it falls back to a binary
// esgotado(0%)/não-esgotado(100%) reading instead of a NaN/Infinity percent.
export function calculateStockPercentRemaining(currentStock: number, referenceQuantity: number): number {
  if (referenceQuantity <= 0) return currentStock > 0 ? 100 : 0
  return (currentStock / referenceQuantity) * 100
}

// Weighted-average purchase cost (spec §1.1, task-3 brief): every new
// AccessoryPurchase (and, task 4, SupplyPurchase) folds into the running
// average instead of replacing it. Creating a brand-new Accessory is just
// this same formula starting from a zeroed-out stock (currentStock=0,
// avgUnitCost=0), which collapses to purchaseTotalCost/purchaseQuantity --
// so createAccessory and registerAccessoryPurchase share this one function.
export interface WeightedAverageCostInput {
  currentStock: number
  avgUnitCost: number
  purchaseQuantity: number
  purchaseTotalCost: number
}

export function calculateWeightedAverageCost(input: WeightedAverageCostInput): number {
  return (
    (input.currentStock * input.avgUnitCost + input.purchaseTotalCost) /
    (input.currentStock + input.purchaseQuantity)
  )
}

// Melhoria "Impressoras": energyCostPerKwh saiu daqui -- tarifa de energia
// virou input por impressora (Printer.energyCostPerKwh, ver
// ProductCostInput/ProductPartCostInput/ProductionCostSnapshotInput
// abaixo) em vez de um valor global de Settings compartilhado por toda
// impressora.
export interface Settings {
  laborCostPerHour: number
  failureRatePercent: number
  marketplaceFeePercent: number
  taxPercent: number
  marketplaceFixedFee: number
  defaultMarkup: number
}

// Configurações §3 — "Composição do custo": one toggle per cost term. Each
// term is ALWAYS calculated and returned in ProductCostBreakdown (so a
// breakdown UI can still show the line, just marked visually disabled) —
// a flag only gates whether that term's value contributes to
// subtotal/finalCost (multiplied by 1 or 0 before summing).
export interface ProductCostFlags {
  includeDepreciation: boolean
  includeEnergyCost: boolean
  includeMaintenance: boolean
  includeLaborCost: boolean
  includeFailureRate: boolean
  includeFilamentCost: boolean
  includeAccessoriesCost: boolean
  includeSuppliesCost: boolean
  includePackagingCost: boolean
}

export interface ProductCostInput extends ProductCostFlags {
  weightGrams: number
  printTimeHours: number
  laborTimeHours: number
  filamentPricePerKg: number
  printerAvgPowerConsumptionKwh: number
  // Melhoria "Impressoras": tarifa da impressora usada nesta peça/produto
  // (Printer.energyCostPerKwh), não mais Settings.energyCostPerKwh.
  printerEnergyCostPerKwh: number
  printerDepreciationCostPerHour: number
  printerMaintenanceCostPerHour: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
}

export interface ProductCostBreakdown {
  filamentCost: number
  electricityCost: number
  printerCost: number
  maintenanceCost: number
  laborCost: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
  // Melhoria "Produto-como-componente": custo dos outros PRODUTOS usados
  // como ingrediente (ex.: Mosquetão dentro de Chaveiro Café) -- sempre 0
  // pra produto simples (nunca tem componentUsages). Somado no subtotal sob
  // a MESMA flag includeAccessoriesCost (ver combineProductCost) -- decisão
  // deliberada pra não precisar de um toggle novo em Settings só pra isso.
  componentProductsCost: number
  // Always calculated (subtotal * failureRatePercent) regardless of
  // includeFailureRate, same transparency rule as every other term.
  failureRateCost: number
  subtotal: number
  finalCost: number
  suggestedPrice: number
  marketplacePrice: number
}

// Configurações §3 — modos de arredondamento do preço final.
export type RoundingMode = 'NONE' | 'R90' | 'R99' | 'R00' | 'CUSTOM'

const ROUNDING_FRACTION: Record<Exclude<RoundingMode, 'NONE' | 'CUSTOM'>, number> = {
  R90: 0.9,
  R99: 0.99,
  R00: 0,
}

/**
 * Applies a fixed-ending rounding rule to a final price (suggested or
 * marketplace) — NEVER to individual cost breakdown components.
 *
 * Rule (chosen because it reproduces the brief's own examples exactly):
 * truncate the value's integer part (`Math.floor`) and replace whatever
 * fractional part it had with a FIXED ending — .90, .99 or .00 — regardless
 * of whether the original fraction was above or below that ending. So
 * 23.45 -> 23.90 (fraction goes up) and 23.95 -> 23.90 (fraction goes down)
 * land on the exact same result, matching "R90 (...) ex: 23.45→23.90, mas
 * 23.95→23.90 também" from the brief. R00 fixes the fraction at .00, which
 * is equivalent to Math.floor. NONE is a no-op passthrough. CUSTOM reuses
 * the exact same truncate-and-fix-ending rule, with the ending taken from
 * `customCents` (0-99, e.g. 50 -> ends in ,50) instead of a fixed table
 * entry — Settings.roundingCustomCents, only meaningful when mode=CUSTOM.
 */
export function applyRounding(value: number, mode: RoundingMode, customCents?: number): number {
  if (mode === 'NONE') return value
  const integerPart = Math.floor(value)
  const fraction = mode === 'CUSTOM' ? (customCents ?? 0) / 100 : ROUNDING_FRACTION[mode]
  const rounded = integerPart + fraction
  // Normalize away binary floating-point noise (e.g. 23 + 0.9 !== 23.9 bit
  // for bit) so callers get a clean 2-decimal currency value.
  return Math.round(rounded * 100) / 100
}

export interface WasteCostInput {
  gramsWasted: number
  timeWastedHours: number
  filamentPricePerKg: number
  printerDepreciationCostPerHour: number
  printerMaintenanceCostPerHour: number
  printerAvgPowerConsumptionKwh: number
  energyCostPerKwh: number
}

export function calculateWasteCost(input: WasteCostInput): number {
  const filamentWasteCost = input.gramsWasted * (input.filamentPricePerKg / 1000)
  const timeWasteCost = input.timeWastedHours * (input.printerDepreciationCostPerHour + input.printerMaintenanceCostPerHour + input.energyCostPerKwh * input.printerAvgPowerConsumptionKwh)
  return filamentWasteCost + timeWasteCost
}

function on(flag: boolean): number {
  return flag ? 1 : 0
}

// Ficha técnica §2 (task-5 brief): both ProductAccessoryUsage and
// ProductSupplyUsage are "list of {quantity, avgUnitCost}" rows that need
// the exact same reduction (sum of quantity * avgUnitCost) to turn into the
// single accessoryCost/suppliesCost number calculateProductCost expects.
// Extracted once so both call sites (getProductCostBreakdown and
// buildProductionCostSnapshot below) share one tested implementation
// instead of two ad-hoc reduce()s that could drift apart.
export interface UsageCostInput {
  quantity: number
  avgUnitCost: number
}

export function sumUsageCost(usages: UsageCostInput[]): number {
  return usages.reduce((sum, u) => sum + u.quantity * u.avgUnitCost, 0)
}

// Termos já calculados (em R$, não mais em peso/tempo/taxa) que
// combineProductCost soma em subtotal/finalCost/preços -- extraído de
// calculateProductCost pra ser reutilizável por
// calculateCompositeProductCost (2.1) abaixo, que chega a esses mesmos 4
// primeiros termos somando várias ProductPart em vez de um único
// peso/impressora/filamento.
export interface ProductCostTerms {
  filamentCost: number
  electricityCost: number
  printerCost: number
  maintenanceCost: number
  laborCost: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
  // Melhoria "Produto-como-componente" -- ver ProductCostBreakdown.componentProductsCost.
  componentProductsCost: number
}

// Grosses up a suggested price so that, after a percentage fee/tax cut and
// a flat fixed fee, the seller is still left with `suggestedPrice`. Shared
// by combineProductCost (using Settings' generic marketplace fee/tax) and
// 4.1's per-platform pricing (using a specific MarketplacePlatform's own
// feePercent/feeFixed instead) -- same formula, different fee source.
export function calculatePlatformPrice(suggestedPrice: number, taxPercent: number, feePercent: number, feeFixed: number): number {
  return suggestedPrice / (1 - feePercent - taxPercent) + feeFixed
}

// Melhoria "Shopee: taxa por faixa de preço": a Shopee cobra taxa%/taxa fixa
// diferentes conforme a faixa de PREÇO DA VENDA (MarketplacePlatform.feeTiers,
// null pra plataforma sem faixas -- ex.: Mercado Livre continua com taxa
// única via feePercent/feeFixed, sem usar nada abaixo). Array ordenado por
// maxPrice crescente, maxPrice null só na última faixa (sem teto).
export interface PlatformFeeTier {
  maxPrice: number | null
  feePercent: number
  feeFixed: number
}

export function resolveTieredPlatformFee(tiers: PlatformFeeTier[], price: number): { feePercent: number; feeFixed: number } {
  const tier = tiers.find((t) => t.maxPrice === null || price <= t.maxPrice) ?? tiers[tiers.length - 1]
  return { feePercent: tier.feePercent, feeFixed: tier.feeFixed }
}

// calculatePlatformPrice "engorda" suggestedPrice até um preço de venda que,
// depois do corte de taxa%+imposto e do fixo, ainda sobra suggestedPrice pro
// vendedor -- mas aqui a taxa certa a usar DEPENDE do preço de venda
// resultante (que é justamente o que estamos calculando). Resolve por ponto
// fixo: chuta com a 1ª faixa, calcula o preço, resolve a faixa de novo pro
// preço calculado, repete até estabilizar -- poucas faixas (sempre <10),
// converge em 1-2 voltas na prática; teto de iterações só como segurança
// contra um caso patológico de faixas mal configuradas oscilando pra sempre.
export function calculateTieredPlatformPrice(suggestedPrice: number, taxPercent: number, tiers: PlatformFeeTier[]): number {
  let price = calculatePlatformPrice(suggestedPrice, taxPercent, tiers[0].feePercent, tiers[0].feeFixed)
  for (let i = 0; i < 5; i++) {
    const fee = resolveTieredPlatformFee(tiers, price)
    const nextPrice = calculatePlatformPrice(suggestedPrice, taxPercent, fee.feePercent, fee.feeFixed)
    if (Math.abs(nextPrice - price) < 0.005) {
      price = nextPrice
      break
    }
    price = nextPrice
  }
  return price
}

// Bug "preço marketplace na tela de Produtos ignora faixa da Shopee":
// getPlatformSalePrice, a tela de Produtos (listagem e detalhe) precisavam
// da MESMA resolução tiered-ou-flat, mas cada um reimplementava o branch
// (ou, no caso de Produtos, nem tinha o branch -- sempre usava
// calculatePlatformPrice com o par flat, que pra Shopee só espelha a 1ª
// faixa). Um helper só, reaproveitado nos 3 lugares, pra nunca mais
// divergir -- devolve não só o preço final, mas também a taxa%/fixa que
// REALMENTE valeu pra ele (a faixa resolvida, quando houver faixas), pra
// telas que precisam mostrar "quanto é a taxa" e não só o preço já embutido.
export interface PlatformPriceBreakdown {
  price: number
  feePercent: number
  feeFixed: number
  // taxa em R$ que a plataforma consome de UMA unidade vendida por `price`
  // (feePercent*price + feeFixed) -- não inclui imposto, que já foi
  // descontado dentro de `price` via calculatePlatformPrice.
  feeAmount: number
}

export function resolvePlatformPrice(
  suggestedPrice: number,
  taxPercent: number,
  flatFeePercent: number,
  flatFeeFixed: number,
  feeTiers: PlatformFeeTier[] | null,
): PlatformPriceBreakdown {
  if (feeTiers && feeTiers.length > 0) {
    const price = calculateTieredPlatformPrice(suggestedPrice, taxPercent, feeTiers)
    const { feePercent, feeFixed } = resolveTieredPlatformFee(feeTiers, price)
    return { price, feePercent, feeFixed, feeAmount: price * feePercent + feeFixed }
  }
  const price = calculatePlatformPrice(suggestedPrice, taxPercent, flatFeePercent, flatFeeFixed)
  return { price, feePercent: flatFeePercent, feeFixed: flatFeeFixed, feeAmount: price * flatFeePercent + flatFeeFixed }
}

export function combineProductCost(terms: ProductCostTerms, flags: ProductCostFlags, settings: Settings): ProductCostBreakdown {
  const subtotal =
    terms.filamentCost * on(flags.includeFilamentCost) +
    terms.electricityCost * on(flags.includeEnergyCost) +
    terms.printerCost * on(flags.includeDepreciation) +
    terms.maintenanceCost * on(flags.includeMaintenance) +
    terms.laborCost * on(flags.includeLaborCost) +
    terms.suppliesCost * on(flags.includeSuppliesCost) +
    terms.packagingCost * on(flags.includePackagingCost) +
    terms.accessoryCost * on(flags.includeAccessoriesCost) +
    terms.componentProductsCost * on(flags.includeAccessoriesCost)

  // Failure rate is applied as a markup on top of subtotal (not a flat
  // additive term), same shape as before the flags existed — always
  // calculated so the UI can show it, gated by includeFailureRate before
  // it contributes to finalCost.
  const failureRateCost = subtotal * settings.failureRatePercent
  const finalCost = subtotal + failureRateCost * on(flags.includeFailureRate)

  const suggestedPrice = finalCost * settings.defaultMarkup
  const marketplacePrice = calculatePlatformPrice(suggestedPrice, settings.taxPercent, settings.marketplaceFeePercent, settings.marketplaceFixedFee)

  return {
    filamentCost: terms.filamentCost,
    electricityCost: terms.electricityCost,
    printerCost: terms.printerCost,
    maintenanceCost: terms.maintenanceCost,
    laborCost: terms.laborCost,
    suppliesCost: terms.suppliesCost,
    packagingCost: terms.packagingCost,
    accessoryCost: terms.accessoryCost,
    componentProductsCost: terms.componentProductsCost,
    failureRateCost,
    subtotal,
    finalCost,
    suggestedPrice,
    marketplacePrice,
  }
}

export function calculateProductCost(input: ProductCostInput, settings: Settings): ProductCostBreakdown {
  // Every term below is always calculated in full, regardless of its flag —
  // the breakdown must keep showing the real value (UI marks it visually
  // disabled instead of hiding it). Only the contribution to subtotal below
  // is gated by the flag.
  const filamentCost = input.weightGrams * (input.filamentPricePerKg / 1000)
  const electricityCost = input.printerAvgPowerConsumptionKwh * input.printerEnergyCostPerKwh * input.printTimeHours
  const printerCost = input.printerDepreciationCostPerHour * input.printTimeHours
  const maintenanceCost = input.printerMaintenanceCostPerHour * input.printTimeHours
  const laborCost = settings.laborCostPerHour * input.laborTimeHours

  return combineProductCost(
    { filamentCost, electricityCost, printerCost, maintenanceCost, laborCost, suppliesCost: input.suppliesCost, packagingCost: input.packagingCost, accessoryCost: input.accessoryCost, componentProductsCost: 0 },
    input,
    settings,
  )
}

// ---------------------------------------------------------------------------
// 2.1 Produto composto (BOM): cada ProductPart tem sua própria impressora/
// filamento/peso/tempo de impressão e uma quantidade necessária por
// unidade do produto final -- o custo de filamento/energia/depreciação/
// manutenção do produto composto é a SOMA desses termos entre as peças
// (cada um já multiplicado por quantityPerUnit). Mão de obra/embalagem/
// insumos/acessórios continuam sendo conceito de produto inteiro (entram
// na montagem, spec 2.3 -- não por peça), então chegam prontos de fora,
// igual calculateProductCost recebe suppliesCost/packagingCost/
// accessoryCost já somados.
// ---------------------------------------------------------------------------

// Ajuste "peça multi-filamento": uma peça pode precisar de várias cores
// AO MESMO TEMPO (impressão multi-material -- ex.: corpo preto 15g +
// detalhe verde 8g). filamentCost de uma peça é a soma de weightGrams *
// pricePerKg de CADA componente da receita (a maioria das peças tem só 1).
export interface ProductPartFilamentComponent {
  weightGrams: number
  filamentPricePerKg: number
}

export interface ProductPartCostInput {
  quantityPerUnit: number
  filamentComponents: ProductPartFilamentComponent[]
  printTimeHours: number
  printerAvgPowerConsumptionKwh: number
  // Melhoria "Impressoras": tarifa da impressora DESSA peça -- um composto
  // pode ter peças em impressoras diferentes, cada uma com sua própria
  // tarifa própria agora (não mais um único Settings.energyCostPerKwh
  // compartilhado por todas).
  printerEnergyCostPerKwh: number
  printerDepreciationCostPerHour: number
  printerMaintenanceCostPerHour: number
}

export interface ProductPartsCostSum {
  filamentCost: number
  electricityCost: number
  printerCost: number
  maintenanceCost: number
}

export function sumProductPartsCost(parts: ProductPartCostInput[]): ProductPartsCostSum {
  return parts.reduce<ProductPartsCostSum>(
    (acc, part) => {
      const qty = part.quantityPerUnit
      const partFilamentCost = part.filamentComponents.reduce((sum, c) => sum + c.weightGrams * (c.filamentPricePerKg / 1000), 0)
      return {
        filamentCost: acc.filamentCost + partFilamentCost * qty,
        electricityCost: acc.electricityCost + part.printerAvgPowerConsumptionKwh * part.printerEnergyCostPerKwh * part.printTimeHours * qty,
        printerCost: acc.printerCost + part.printerDepreciationCostPerHour * part.printTimeHours * qty,
        maintenanceCost: acc.maintenanceCost + part.printerMaintenanceCostPerHour * part.printTimeHours * qty,
      }
    },
    { filamentCost: 0, electricityCost: 0, printerCost: 0, maintenanceCost: 0 },
  )
}

export interface CompositeProductCostInput extends ProductCostFlags {
  parts: ProductPartCostInput[]
  laborTimeHours: number
  suppliesCost: number
  packagingCost: number
  accessoryCost: number
  // Melhoria "Produto-como-componente" -- ver ProductCostBreakdown.componentProductsCost.
  // Opcional (default 0) pra não quebrar chamadas existentes sem componente-produto.
  componentProductsCost?: number
}

export function calculateCompositeProductCost(input: CompositeProductCostInput, settings: Settings): ProductCostBreakdown {
  const partsSum = sumProductPartsCost(input.parts)
  const laborCost = settings.laborCostPerHour * input.laborTimeHours

  return combineProductCost(
    {
      ...partsSum,
      laborCost,
      suppliesCost: input.suppliesCost,
      packagingCost: input.packagingCost,
      accessoryCost: input.accessoryCost,
      componentProductsCost: input.componentProductsCost ?? 0,
    },
    input,
    settings,
  )
}

// ---------------------------------------------------------------------------
// "Simulação de preço" (spec §2, task-6 brief)
//
// A client-side-only pricing preview: the Products edit page lets the user
// temporarily override markup/margin/discount (never persisted, never fed
// back into calculateProductCost above, which stays exactly as Task 5 left
// it -- markup-only, still the canonical/persisted breakdown). This
// function is the one place margin/discount currently affect a price:
//   1. markup-based price = finalCost * markup, same shape as
//      calculateProductCost's suggestedPrice.
//   2. margin-based floor = finalCost / (1 - marginPercent) -- guarantees
//      the suggested price never implies less than the desired profit
//      margin, even if markup alone would undercut it.
//   3. suggestedPrice = max(1, 2), with a promotional discountPercent
//      applied on top of whichever wins.
//   4. marketplacePrice reuses calculateProductCost's exact fee/tax/
//      fixed-fee formula, applied to the (possibly discounted)
//      suggestedPrice above.
// With Settings' actual defaults (markup=2.00, margin=0.30, discount=0) the
// margin floor never binds and the discount is a no-op, so this reproduces
// calculateProductCost's suggestedPrice/marketplacePrice exactly -- this is
// what lets the UI show a default calculated price preview using Settings'
// current values before any simulation control is touched.
// ---------------------------------------------------------------------------

export interface PriceSimulationInput {
  finalCost: number
  markup: number
  marginPercent: number
  discountPercent: number
  marketplaceFeePercent: number
  taxPercent: number
  marketplaceFixedFee: number
}

export interface PriceSimulationResult {
  suggestedPrice: number
  marketplacePrice: number
}

export function simulateProductPrice(input: PriceSimulationInput): PriceSimulationResult {
  const markupPrice = input.finalCost * input.markup
  const marginFloorPrice = input.marginPercent >= 1 ? Infinity : input.finalCost / (1 - input.marginPercent)
  const basePrice = Math.max(markupPrice, marginFloorPrice)
  const suggestedPrice = basePrice * (1 - input.discountPercent)
  const marketplacePrice =
    suggestedPrice / (1 - input.marketplaceFeePercent - input.taxPercent) + input.marketplaceFixedFee
  return { suggestedPrice, marketplacePrice }
}

// ---------------------------------------------------------------------------
// Production cost snapshot (spec §4/§5, task-5 brief)
//
// Historical-cost architecture: a ProductionRun freezes its entire cost
// picture at creation time into a `costSnapshot Json` column that is never
// recalculated or rewritten afterwards — later Settings/Printer/Filament/
// Accessory/Supply changes must never alter an already-recorded run's cost
// (spec §4). buildProductionCostSnapshot is the ONE place that shape gets
// built, so its return type here IS the exact contract stored in that
// column and read back by every later screen (production history, cost
// column, dashboard aggregation) and by cancelProductionRun's reversal
// logic (Task 6+ of this plan) — those consumers exist to be built on top
// of this shape, not the other way around, so changing field names/shapes
// here later is a breaking migration of every already-stored JSON row.
//
// Deliberately built from plain-number inputs (like every other function in
// this file) rather than Prisma models, so it's callable from a pure unit
// test with zero DB/Decimal setup — the caller (an actions/ file) is
// responsible for `.toNumber()`-ing Decimals and shaping ProductAccessoryUsage/
// ProductSupplyUsage rows into the plain {id, quantity, avgUnitCost} shape
// below before calling this.
// ---------------------------------------------------------------------------

export interface ProductionAccessoryUsageInput {
  accessoryId: string
  quantity: number // per single unit of product, i.e. the ficha técnica quantity
  avgUnitCost: number // Accessory.avgUnitCost at production time
}

export interface ProductionSupplyUsageInput {
  supplyId: string
  quantity: number // per single unit of product
  avgUnitCost: number // Supply.avgUnitCost at production time
}

// Melhoria "Produtos" §3: generaliza a antiga embalagem-única
// (packagingItemId/packagingCost soltos) numa lista, mesmo shape de
// ProductionAccessoryUsageInput/ProductionSupplyUsageInput -- packagingCost
// deixa de ser passado já somado e vira computado aqui dentro (sumUsageCost),
// igual accessoryCost/suppliesCost.
export interface ProductionPackagingUsageInput {
  packagingItemId: string
  quantity: number // per single unit of product
  avgUnitCost: number // PackagingItem.avgUnitCost at production time
}

export interface ProductionCostSnapshotInput extends ProductCostFlags {
  // Ficha técnica (per single unit) — same fields calculateProductCost takes,
  // minus the already-summed suppliesCost/accessoryCost/packagingCost
  // (computed internally below via sumUsageCost from the lists instead).
  weightGrams: number
  printTimeHours: number
  laborTimeHours: number
  filamentPricePerKg: number
  printerAvgPowerConsumptionKwh: number
  // Melhoria "Impressoras": tarifa da impressora usada nesta produção
  // (Printer.energyCostPerKwh), não mais Settings.energyCostPerKwh.
  printerEnergyCostPerKwh: number
  printerDepreciationCostPerHour: number
  printerMaintenanceCostPerHour: number
  accessoryUsages: ProductionAccessoryUsageInput[]
  supplyUsages: ProductionSupplyUsageInput[]
  packagingUsages: ProductionPackagingUsageInput[]

  // Resource identities needed to record (and later reverse) consumption —
  // not used in any cost formula, only copied into consumedResources below.
  filamentId: string

  // This specific production run.
  quantityPlanned: number
  quantitySuccess: number // only these consume accessories/insumos/embalagem (spec §5.1)
  quantityFailed: number
  gramsUsed: number
  gramsWasted: number
  timeWastedHours: number
}

// Everything Task 7's cancelProductionRun needs to reverse stock WITHOUT
// re-querying the product's current ficha técnica (which may have changed
// since this run was created) — every resource actually touched, by id,
// with the exact quantity consumed and the unit cost that was in effect at
// the time (spec §5.1/§5.5, task-5 brief).
export interface ProductionResourceConsumption {
  filament: { filamentId: string; gramsUsed: number; gramsWasted: number }
  accessories: { accessoryId: string; quantityPerUnit: number; quantityConsumed: number; unitCost: number }[]
  supplies: { supplyId: string; quantityPerUnit: number; quantityConsumed: number; unitCost: number }[]
  packaging: { packagingItemId: string; quantityPerUnit: number; quantityConsumed: number; unitCost: number }[]
}

export interface ProductionCostSnapshot {
  quantityPlanned: number
  quantitySuccess: number
  quantityFailed: number
  // Per-unit cost breakdown, identical shape to calculateProductCost's
  // output, computed once here from Printer/Filament/Settings/Product as
  // they stood at production time (spec §4).
  unitCost: ProductCostBreakdown
  // Cost of the grams/time lost to failed units (calculateWasteCost), kept
  // as a separate additive term rather than folded into unitCost.finalCost
  // — it belongs to the run as a whole, not to any single successful unit.
  wasteCost: number
  // The number every later screen reads instead of recalculating (spec §4/
  // Task 8-9: "coluna Custo lê costSnapshot.total", dashboard sums it):
  // cost of every successful unit produced, plus whatever was wasted on the
  // failed ones.
  total: number
  consumedResources: ProductionResourceConsumption
  // Melhoria "Editar impressora depois de criar": congela o tempo de
  // impressão (já ALOCADO via allocatePlatePrintTime pra peça de Plate) e os
  // 3 flags de composição de custo que decidem se cada termo de impressora
  // entra em subtotal/finalCost -- sem isso não dá pra recalcular
  // printerCost/maintenanceCost/electricityCost pra uma impressora NOVA com
  // precisão (só por aproximação). Opcionais porque produção anterior a essa
  // mudança nunca teve esses campos gravados -- updateProductionRunPrinter
  // (actions/productionRuns.ts) bloqueia a troca de impressora quando
  // ausentes, nunca inventa o valor.
  printTimeHours?: number
  printerCostFlags?: { includeDepreciation: boolean; includeMaintenance: boolean; includeEnergyCost: boolean }
}

export function buildProductionCostSnapshot(
  input: ProductionCostSnapshotInput,
  settings: Settings,
): ProductionCostSnapshot {
  const suppliesCost = sumUsageCost(input.supplyUsages)
  const accessoryCost = sumUsageCost(input.accessoryUsages)
  const packagingCost = sumUsageCost(input.packagingUsages)

  const unitCost = calculateProductCost(
    {
      weightGrams: input.weightGrams,
      printTimeHours: input.printTimeHours,
      laborTimeHours: input.laborTimeHours,
      filamentPricePerKg: input.filamentPricePerKg,
      printerAvgPowerConsumptionKwh: input.printerAvgPowerConsumptionKwh,
      printerEnergyCostPerKwh: input.printerEnergyCostPerKwh,
      printerDepreciationCostPerHour: input.printerDepreciationCostPerHour,
      printerMaintenanceCostPerHour: input.printerMaintenanceCostPerHour,
      suppliesCost,
      packagingCost,
      accessoryCost,
      includeDepreciation: input.includeDepreciation,
      includeEnergyCost: input.includeEnergyCost,
      includeMaintenance: input.includeMaintenance,
      includeLaborCost: input.includeLaborCost,
      includeFailureRate: input.includeFailureRate,
      includeFilamentCost: input.includeFilamentCost,
      includeAccessoriesCost: input.includeAccessoriesCost,
      includeSuppliesCost: input.includeSuppliesCost,
      includePackagingCost: input.includePackagingCost,
    },
    settings,
  )

  const wasteCost = calculateWasteCost({
    gramsWasted: input.gramsWasted,
    timeWastedHours: input.timeWastedHours,
    filamentPricePerKg: input.filamentPricePerKg,
    printerDepreciationCostPerHour: input.printerDepreciationCostPerHour,
    printerMaintenanceCostPerHour: input.printerMaintenanceCostPerHour,
    printerAvgPowerConsumptionKwh: input.printerAvgPowerConsumptionKwh,
    energyCostPerKwh: input.printerEnergyCostPerKwh,
  })

  const total = unitCost.finalCost * input.quantitySuccess + wasteCost

  // Physical consumption is NEVER gated by the include* cost flags — those
  // only control whether a term counts toward the displayed subtotal/total,
  // they say nothing about whether the piece physically used the resource.
  // A produced unit always consumes its full ficha técnica.
  const consumedResources: ProductionResourceConsumption = {
    filament: {
      filamentId: input.filamentId,
      gramsUsed: input.gramsUsed,
      gramsWasted: input.gramsWasted,
    },
    accessories: input.accessoryUsages.map((u) => ({
      accessoryId: u.accessoryId,
      quantityPerUnit: u.quantity,
      quantityConsumed: u.quantity * input.quantitySuccess,
      unitCost: u.avgUnitCost,
    })),
    supplies: input.supplyUsages.map((u) => ({
      supplyId: u.supplyId,
      quantityPerUnit: u.quantity,
      quantityConsumed: u.quantity * input.quantitySuccess,
      unitCost: u.avgUnitCost,
    })),
    packaging: input.packagingUsages.map((u) => ({
      packagingItemId: u.packagingItemId,
      quantityPerUnit: u.quantity,
      quantityConsumed: u.quantity * input.quantitySuccess,
      unitCost: u.avgUnitCost,
    })),
  }

  return {
    quantityPlanned: input.quantityPlanned,
    quantitySuccess: input.quantitySuccess,
    quantityFailed: input.quantityFailed,
    unitCost,
    wasteCost,
    total,
    consumedResources,
    printTimeHours: input.printTimeHours,
    printerCostFlags: {
      includeDepreciation: input.includeDepreciation,
      includeMaintenance: input.includeMaintenance,
      includeEnergyCost: input.includeEnergyCost,
    },
  }
}

// Melhoria "Editar impressora depois de criar": recalcula só a parte do
// costSnapshot congelado que depende da impressora (printerCost/
// maintenanceCost/electricityCost do unitCost + a parcela de impressora do
// wasteCost) pra uma impressora NOVA, preservando tudo o mais (filamento,
// mão de obra, insumos/acessórios/embalagem, consumedResources) exatamente
// como estava. Só chamável quando o snapshot já tem printTimeHours/
// printerCostFlags congelados (ver ProductionCostSnapshot) -- o chamador
// (actions/productionRuns.ts#updateProductionRunPrinter) garante isso antes.
//
// Taxas/hora da impressora ANTIGA nunca precisam ser buscadas de novo no
// banco -- são derivadas de volta a partir do que já está congelado
// (unitCost.printerCost / printTimeHours etc.), então o resultado nunca
// diverge mesmo que a impressora antiga tenha sido editada ou desativada
// desde então.
//
// subtotal/finalCost são ajustados por DELTA (soma a diferença dos 3 termos,
// cada um gated pelo printerCostFlags congelado) em vez de recalculados do
// zero -- reaplicar a proporção oldFinalCost/oldSubtotal captura
// implicitamente a taxa de falha (includeFailureRate) que gerou aquele
// finalCost sem precisar rebuscar Settings nem saber se a flag estava
// ligada. suggestedPrice é escalado na mesma proporção sobre finalCost --
// só mantido internamente consistente, nenhuma tela de ProductionRun exibe
// esse campo hoje. marketplacePrice idem, mesma aproximação.
export interface PrinterCostRecomputeInput {
  snapshot: ProductionCostSnapshot
  // run.timeWastedHours -- coluna real, sempre disponível mesmo pra
  // produção anterior a este recurso (diferente de printTimeHours).
  timeWastedHours: number
  newPrinter: {
    depreciationCostPerHour: number
    maintenanceCostPerHour: number
    avgPowerConsumptionKwh: number
    energyCostPerKwh: number
  }
}

export function recomputeProductionRunPrinterCost(input: PrinterCostRecomputeInput): ProductionCostSnapshot {
  const { snapshot, timeWastedHours, newPrinter } = input
  const printTimeHours = snapshot.printTimeHours ?? 0
  const flags = snapshot.printerCostFlags ?? { includeDepreciation: false, includeMaintenance: false, includeEnergyCost: false }
  const oldUnitCost = snapshot.unitCost

  // Taxas/hora antigas, derivadas de volta a partir do congelado -- 0 quando
  // printTimeHours é 0 (nada a derivar, os termos novos também dão 0).
  const oldDepreciationRate = printTimeHours > 0 ? oldUnitCost.printerCost / printTimeHours : 0
  const oldMaintenanceRate = printTimeHours > 0 ? oldUnitCost.maintenanceCost / printTimeHours : 0
  const oldElectricityRate = printTimeHours > 0 ? oldUnitCost.electricityCost / printTimeHours : 0

  const newPrinterCost = newPrinter.depreciationCostPerHour * printTimeHours
  const newMaintenanceCost = newPrinter.maintenanceCostPerHour * printTimeHours
  const newElectricityCost = newPrinter.avgPowerConsumptionKwh * newPrinter.energyCostPerKwh * printTimeHours

  const oldIncluded =
    oldUnitCost.printerCost * on(flags.includeDepreciation) +
    oldUnitCost.maintenanceCost * on(flags.includeMaintenance) +
    oldUnitCost.electricityCost * on(flags.includeEnergyCost)
  const newIncluded =
    newPrinterCost * on(flags.includeDepreciation) +
    newMaintenanceCost * on(flags.includeMaintenance) +
    newElectricityCost * on(flags.includeEnergyCost)
  const delta = newIncluded - oldIncluded

  const newSubtotal = oldUnitCost.subtotal + delta
  const finalCostRatio = oldUnitCost.subtotal !== 0 ? oldUnitCost.finalCost / oldUnitCost.subtotal : 1
  const newFinalCost = newSubtotal * finalCostRatio
  const suggestedPriceRatio = oldUnitCost.finalCost !== 0 ? oldUnitCost.suggestedPrice / oldUnitCost.finalCost : 1
  const newSuggestedPrice = newFinalCost * suggestedPriceRatio
  const marketplacePriceRatio = oldUnitCost.suggestedPrice !== 0 ? oldUnitCost.marketplacePrice / oldUnitCost.suggestedPrice : 1
  const newMarketplacePrice = newSuggestedPrice * marketplacePriceRatio

  const oldTimeWasteCost = timeWastedHours * (oldDepreciationRate + oldMaintenanceRate + oldElectricityRate)
  const newTimeWasteCost =
    timeWastedHours * (newPrinter.depreciationCostPerHour + newPrinter.maintenanceCostPerHour + newPrinter.avgPowerConsumptionKwh * newPrinter.energyCostPerKwh)
  const newWasteCost = snapshot.wasteCost - oldTimeWasteCost + newTimeWasteCost

  const newTotal = newFinalCost * snapshot.quantitySuccess + newWasteCost

  return {
    ...snapshot,
    unitCost: {
      ...oldUnitCost,
      printerCost: newPrinterCost,
      maintenanceCost: newMaintenanceCost,
      electricityCost: newElectricityCost,
      subtotal: newSubtotal,
      finalCost: newFinalCost,
      suggestedPrice: newSuggestedPrice,
      marketplacePrice: newMarketplacePrice,
    },
    wasteCost: newWasteCost,
    total: newTotal,
  }
}

// ---------------------------------------------------------------------------
// Plate / impressão simultânea (reformulação "Produção")
//
// Várias peças impressas juntas na mesma impressão física compartilham o
// custo de impressora (depreciação+manutenção+energia) em vez de cada uma
// pagar o valor cheio -- REGRA 11/21 do pedido. printerCost/maintenanceCost/
// electricityCost em calculateProductCost acima são todos LINEARES em
// printTimeHours (taxa_por_hora × printTimeHours), então ratear não exige
// nenhuma fórmula nova: basta o chamador (buildProductionCostSnapshot,
// actions/productionRuns.ts) passar um printTimeHours "alocado" no lugar do
// tempo cru da ficha técnica, só para o cálculo de custo -- o "Tempo de
// impressão esperado" exibido em qualquer outro lugar continua lendo
// ProductPart/Product.printTimeHours direto do catálogo, sem alteração
// nenhuma (REGRA 15/16: não mexer na lógica de tempo existente).
export interface PlateAllocationItem {
  printTimeHoursPerUnit: number
  quantityPlanned: number
}

// Critério confirmado com o usuário: percentual de cada peça = seu peso
// (tempo esperado × quantidade planejada) sobre a soma dos pesos de todas
// as peças da Plate. Tempo total da Plate = o tempo da peça mais lenta --
// impressão simultânea é limitada pelo gargalo (todas terminam juntas,
// junto com a mais demorada), não pela soma sequencial de cada uma; isso
// não exige nenhum campo novo de "tempo real" digitado pelo usuário.
// Retorna, na mesma ordem de `items`, o printTimeHours alocado de cada
// peça -- a soma dos retornados bate exatamente com o tempo total da Plate.
export function allocatePlatePrintTime(items: PlateAllocationItem[]): number[] {
  if (items.length === 0) return []
  const weights = items.map((i) => i.printTimeHoursPerUnit * i.quantityPlanned)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const plateTotalTimeHours = Math.max(...items.map((i) => i.printTimeHoursPerUnit))
  // Nenhum peso real (ex.: toda peça com tempo/quantidade zerados) -- não
  // há base pra ratear, divide igualmente em vez de devolver NaN/Infinity.
  if (totalWeight <= 0) {
    return items.map(() => plateTotalTimeHours / items.length)
  }
  return weights.map((w) => (w / totalWeight) * plateTotalTimeHours)
}

// ---------------------------------------------------------------------------
// Sale cost snapshot (task-10 brief, new feature -- explicit user request
// after the final whole-branch review, mirroring ProductionRun.costSnapshot
// exactly).
//
// A Sale freezes its cost basis at creation time into a `costSnapshot Json?`
// column, same historical-cost architecture as ProductionRun (spec §4):
// later Settings/Printer/Filament/Accessory/Supply changes must never alter
// an already-recorded sale's displayed profit. Deliberately the SAME
// {unitCost, total} shape as ProductionCostSnapshot above (unitCost is the
// full per-unit ProductCostBreakdown, total is the aggregate figure every
// later screen reads) so a caller familiar with one recognizes the other --
// a Sale has no waste/quantityFailed concept of its own, so there is no
// wasteCost/consumedResources term here; `total` is simply
// unitCost.finalCost * quantity, the total cost basis this sale represents.
export interface SaleCostSnapshot {
  quantity: number
  unitCost: ProductCostBreakdown
  total: number
  // Melhoria "Mostrar taxa da plataforma": taxa REAL cobrada nesta venda,
  // resolvida uma vez na criação a partir do unitPrice de verdade (não do
  // preço sugerido) -- mesmo princípio de custo histórico congelado do
  // resto do snapshot. Ausente pra venda Direta/canal legado MARKETPLACE
  // (nunca tiveram taxa) e pra venda anterior a este ajuste (nenhum dado
  // histórico pra reconstruir -- nunca inventado retroativamente).
  platformFee?: {
    feePercent: number
    feeFixed: number
    amountTotal: number
  }
}

export function buildSaleCostSnapshot(
  breakdown: ProductCostBreakdown,
  quantity: number,
  platformFee?: { feePercent: number; feeFixed: number; amountTotal: number },
): SaleCostSnapshot {
  return {
    quantity,
    unitCost: breakdown,
    total: breakdown.finalCost * quantity,
    ...(platformFee ? { platformFee } : {}),
  }
}

// Brinde (spec "Brinde reciclado no sistema"): trilha de custeio própria e
// paralela à de produto normal acima -- não usa Impressora/Filamento/
// ProductPart/ProductCostFlags (nenhum desses termos faz sentido pra um
// item montado de sobra reciclada + acessório + equipamento rateado, não
// "impresso" no sentido do fluxo de Produção). Equipamento (ex.: soprador
// térmico, forma de silicone) deprecia por USO (purchasePrice ÷
// usefulLifeUses), não por hora como Printer.depreciationHours -- aqui não
// existe um "tempo de impressão" real pra ratear. Energia só entra quando
// powerWatts > 0 (equipamento sem consumo elétrico, ex. forma de silicone,
// fica com energy=0 sem quebrar o cálculo).
export interface GiftEquipmentLineInput {
  name: string
  purchasePrice: number
  usefulLifeUses: number
  powerWatts: number
  minutesPerUnit: number
}

export interface GiftEquipmentLineCost {
  name: string
  depreciation: number
  energy: number
  costPerUnit: number
}

export function calculateGiftEquipmentCostPerUnit(input: GiftEquipmentLineInput, energyCostPerKwh: number): GiftEquipmentLineCost {
  const depreciation = input.usefulLifeUses > 0 ? input.purchasePrice / input.usefulLifeUses : 0
  const energy = input.powerWatts > 0 ? (input.powerWatts / 1000) * (input.minutesPerUnit / 60) * energyCostPerKwh : 0
  return { name: input.name, depreciation, energy, costPerUnit: depreciation + energy }
}

export interface GiftProductCostBreakdown {
  materialsCost: number
  accessoriesCost: number
  equipmentCost: number
  equipmentBreakdown: GiftEquipmentLineCost[]
  finalCost: number
}

export function calculateGiftProductCost(
  materials: { unitCost: number }[],
  accessories: { quantity: number; avgUnitCost: number }[],
  equipment: GiftEquipmentLineInput[],
  energyCostPerKwh: number,
): GiftProductCostBreakdown {
  const materialsCost = materials.reduce((sum, m) => sum + m.unitCost, 0)
  const accessoriesCost = accessories.reduce((sum, a) => sum + a.quantity * a.avgUnitCost, 0)
  const equipmentBreakdown = equipment.map((e) => calculateGiftEquipmentCostPerUnit(e, energyCostPerKwh))
  const equipmentCost = equipmentBreakdown.reduce((sum, e) => sum + e.costPerUnit, 0)
  return {
    materialsCost,
    accessoriesCost,
    equipmentCost,
    equipmentBreakdown,
    finalCost: materialsCost + accessoriesCost + equipmentCost,
  }
}
