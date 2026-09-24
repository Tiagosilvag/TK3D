'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolvePlatformPrice, resolveTieredPlatformFee, resolveListingFee, resolveListingTiers, type PlatformFeeTier, type PlatformPriceBreakdown } from '@/lib/costing'
import { getProductCostBreakdown } from './products'
import { revalidatePath } from 'next/cache'
import { Prisma, type MarketplacePlatformKind, type SaleChannel, type ListingType } from '@prisma/client'

type ActionResult = { success: boolean; error?: string }

// 4.1: só existem 2 linhas fixas (Shopee/Mercado Livre), seedadas pela
// migration -- este formulário só edita as taxas, nunca cria/remove linhas.
// Melhoria "Configurações" §5: as 2 linhas deixaram de ter uma tela própria
// -- viram parte do card Precificação em /settings (SettingsForm), daí o
// revalidatePath abaixo.
//
// Melhoria "Shopee: taxa por faixa de preço": feeTiersJson é opcional -- só
// a Shopee envia (5 faixas fixas na UI, ver SettingsForm.tsx). Quando
// ausente (Mercado Livre), feePercent/feeFixed continuam sendo a taxa
// única de sempre, sem tocar em feeTiers.
const feeTierSchema = z.object({
  maxPrice: z.number().nullable(),
  feePercent: z.number().min(0, 'Taxa não pode ser negativa').max(1, 'Taxa deve ser uma fração entre 0 e 1'),
  feeFixed: z.number().min(0, 'Valor não pode ser negativo'),
})
const feesSchema = z.object({
  feePercent: z.coerce.number({ invalid_type_error: 'Taxa inválida' }).min(0, 'Taxa não pode ser negativa').max(1, 'Taxa deve ser uma fração entre 0 e 1'),
  feeFixed: z.coerce.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo'),
  avgFreight: z.coerce.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo'),
  feeTiersJson: z.string().optional(),
  // Anúncios: 2ª tabela de taxa do Mercado Livre (Premium) -- mesmo
  // formato/validação de feeTiersJson acima, só o Mercado Livre envia
  // (Shopee nunca manda este campo, fica sempre null).
  feeTiersPremiumJson: z.string().optional(),
  // Melhoria "Mercado Livre: taxa por faixa de preço": nota livre da
  // categoria a que a comissão se refere -- só o Mercado Livre envia,
  // puramente informativo (ver comentário no schema).
  categoryReference: z.string().optional(),
})

// Valida um array de faixas (ordem crescente, só a última sem teto) --
// extraído pra ser reaproveitado tanto por feeTiersJson (Clássico/Shopee)
// quanto por feeTiersPremiumJson (Premium) sem duplicar a checagem.
function parseFeeTiersJson(json: string): { tiers: PlatformFeeTier[] } | { error: string } {
  let rawTiers: unknown
  try {
    rawTiers = JSON.parse(json)
  } catch {
    return { error: 'Faixas de taxa inválidas' }
  }
  const tiersParsed = z.array(feeTierSchema).min(1).safeParse(rawTiers)
  if (!tiersParsed.success) return { error: 'Faixas de taxa inválidas' }
  const tiers = tiersParsed.data
  for (let i = 0; i < tiers.length; i++) {
    const isLast = i === tiers.length - 1
    if (isLast ? tiers[i].maxPrice !== null : tiers[i].maxPrice === null) {
      return { error: 'Só a última faixa pode ficar sem "até" (faixa aberta)' }
    }
    if (!isLast && tiers[i].maxPrice! <= (i > 0 ? tiers[i - 1].maxPrice! : -Infinity)) {
      return { error: 'As faixas devem estar em ordem crescente de preço' }
    }
  }
  return { tiers }
}

export async function updateMarketplacePlatformFees(platform: MarketplacePlatformKind, formData: FormData): Promise<ActionResult> {
  const parsed = feesSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { feeTiersJson, feeTiersPremiumJson, ...fees } = parsed.data

  let feeTiers: PlatformFeeTier[] | undefined
  if (feeTiersJson) {
    const result = parseFeeTiersJson(feeTiersJson)
    if ('error' in result) return { success: false, error: result.error }
    feeTiers = result.tiers
  }

  let feeTiersPremium: PlatformFeeTier[] | undefined
  if (feeTiersPremiumJson) {
    const result = parseFeeTiersJson(feeTiersPremiumJson)
    if ('error' in result) return { success: false, error: result.error }
    feeTiersPremium = result.tiers
  }

  await prisma.marketplacePlatform.update({
    where: { platform },
    data: {
      ...fees,
      ...(feeTiers ? { feeTiers: feeTiers as unknown as Prisma.InputJsonValue } : {}),
      ...(feeTiersPremium ? { feeTiersPremium: feeTiersPremium as unknown as Prisma.InputJsonValue } : {}),
    },
  })
  revalidatePath('/settings')
  revalidatePath('/listings')
  return { success: true }
}

// 3.6: prefill do valor unitário sugerido numa venda Shopee/Mercado Livre,
// usando a taxa específica DAQUELA plataforma (em vez do par genérico
// Settings.marketplaceFeePercent/marketplaceFixedFee que o prefill de
// "Marketplace" genérico usava antes). Melhoria "Shopee: taxa por faixa de
// preço": resolvePlatformPrice (lib/costing.ts) decide sozinho entre
// faixas (feeTiers presente, ex.: Shopee) ou taxa única (ausente, ex.:
// Mercado Livre) -- mesmo helper usado pela tela de Produtos, pra nunca
// divergir de novo. Retorna o breakdown completo (não só o preço) --
// melhoria "Mostrar taxa da plataforma": SaleForm.tsx usa feePercent/
// feeFixed/feeAmount pra mostrar a taxa aplicada, não só o preço final.
// Melhoria "mais de 1 anúncio por produto": Listing deixou de ter no
// máximo 1 linha por produto+plataforma (Mercado Livre agora permite 1
// Clássico + 1 Premium ao mesmo tempo, ver schema.prisma) -- não dá mais
// pra achar "o" anúncio de um produto+plataforma com findUnique. Quando
// `listingType` é informado, filtra por ele (escolha explícita). Sem
// informar (SaleForm.tsx não rastreia de qual anúncio uma venda veio),
// desempata por: ONLINE primeiro (é o que realmente está publicado
// cobrando esse preço/taxa/frete agora), senão o mais recentemente
// editado -- mesmo comportamento de antes quando só existia 1 linha
// possível.
async function findRelevantListing(productId: string, platformId: string, listingType?: ListingType) {
  const candidates = await prisma.listing.findMany({
    where: { productId, platformId, ...(listingType ? { listingType } : {}) },
    orderBy: { updatedAt: 'desc' },
  })
  return candidates.find((l) => l.status === 'ONLINE') ?? candidates[0] ?? null
}

// Anúncios: 3º parâmetro opcional -- quando informado (Mercado Livre),
// escolhe entre Clássico/Premium via resolveListingTiers; chamadas
// existentes (SaleForm.tsx) continuam passando só 2 argumentos, sem
// quebrar (cai em findRelevantListing sem filtro de tipo, que desempata
// sozinho). Também passa a checar se já existe um Listing (anúncio real)
// pra esse produto+plataforma -- se existir, o preço/taxa REAIS do
// anúncio prevalecem sobre o cálculo teórico (custo+markup+taxa) abaixo,
// já que é isso que o vendedor realmente cobra nesse canal.
export async function getPlatformSalePrice(
  productId: string,
  platform: MarketplacePlatformKind,
  listingType?: ListingType,
): Promise<PlatformPriceBreakdown> {
  const platformConfig = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform } })
  const listing = await findRelevantListing(productId, platformConfig.id, listingType)
  if (listing) {
    const price = listing.price.toNumber()
    const tiers = resolveListingTiers(platformConfig, listing.listingType)
    const { feePercent, feeFixed, feeAmount } = resolveListingFee(price, tiers, platformConfig.feePercent.toNumber(), platformConfig.feeFixed.toNumber())
    return { price, feePercent, feeFixed, feeAmount }
  }

  const [breakdown, settings] = await Promise.all([getProductCostBreakdown(productId), prisma.settings.findUniqueOrThrow({ where: { id: 1 } })])
  const tiers = resolveListingTiers(platformConfig, listingType)
  return resolvePlatformPrice(
    breakdown.suggestedPrice,
    settings.taxPercent.toNumber(),
    platformConfig.feePercent.toNumber(),
    platformConfig.feeFixed.toNumber(),
    tiers,
  )
}

// Melhoria "Mostrar taxa da plataforma": taxa REAL cobrada numa venda, pra
// congelar no costSnapshot (lib/costing.ts#buildSaleCostSnapshot) no
// momento da criação -- ao contrário de getPlatformSalePrice acima (que
// resolve a faixa certa pro PREÇO SUGERIDO, com o ponto fixo de
// calculateTieredPlatformPrice porque a faixa depende do preço final que
// ainda não existe), aqui o preço JÁ FOI DECIDIDO (o unitPrice de verdade
// da venda) -- só resolver a faixa certa pra ele direto, sem gross-up.
// `null` pra DIRETA/MARKETPLACE (canal antigo): nenhum dos dois nunca teve
// taxa de plataforma.
//
// Anúncios: `productId` opcional -- quando informado, checa se existe um
// Listing pra esse produto+canal e usa o `listingType` dele (Clássico/
// Premium) pra escolher a tabela de taxa certa via resolveListingTiers;
// sem Listing ou sem productId, cai em feeTiers (Clássico), comportamento
// de sempre.
export async function resolveSalePlatformFee(
  channel: SaleChannel,
  unitPrice: number,
  productId?: string,
): Promise<{ feePercent: number; feeFixed: number; feeAmountPerUnit: number } | null> {
  if (channel !== 'SHOPEE' && channel !== 'MERCADO_LIVRE') return null
  const platformConfig = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: channel } })
  const listing = productId ? await findRelevantListing(productId, platformConfig.id) : null
  const tiers = resolveListingTiers(platformConfig, listing?.listingType)
  const { feePercent, feeFixed } =
    tiers && tiers.length > 0
      ? resolveTieredPlatformFee(tiers, unitPrice)
      : { feePercent: platformConfig.feePercent.toNumber(), feeFixed: platformConfig.feeFixed.toNumber() }
  return { feePercent, feeFixed, feeAmountPerUnit: unitPrice * feePercent + feeFixed }
}

// Melhoria "Frete em Vendas": pré-preenchimento do campo Frete no
// formulário de Vendas -- mesmo espírito de resolveSalePlatformFee acima
// (chamado do client, só pra sugerir um valor inicial editável, nunca pra
// travar/congelar nada). Prioridade: frete REAL do Anúncio já cadastrado
// pra esse produto+plataforma (Listing.freightCost, o vendedor já sabe
// quanto realmente paga nesse canal) -- sem Anúncio, cai na média
// configurada da plataforma (MarketplacePlatform.avgFreight, mesmo
// fallback que createListingDraft usa pra um Anúncio novo). 0 pra
// Direta/canal legado MARKETPLACE (sem frete rastreado hoje).
export async function resolveSaleFreight(channel: SaleChannel, productId?: string): Promise<number> {
  if (channel !== 'SHOPEE' && channel !== 'MERCADO_LIVRE') return 0
  const platformConfig = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: channel } })
  const listing = productId ? await findRelevantListing(productId, platformConfig.id) : null
  return (listing?.freightCost ?? platformConfig.avgFreight).toNumber()
}
