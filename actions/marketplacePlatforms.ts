'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { calculatePlatformPrice, calculateTieredPlatformPrice, type PlatformFeeTier } from '@/lib/costing'
import { getProductCostBreakdown } from './products'
import { revalidatePath } from 'next/cache'
import { Prisma, type MarketplacePlatformKind } from '@prisma/client'

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
})

export async function updateMarketplacePlatformFees(platform: MarketplacePlatformKind, formData: FormData): Promise<ActionResult> {
  const parsed = feesSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { feeTiersJson, ...fees } = parsed.data

  let feeTiers: PlatformFeeTier[] | undefined
  if (feeTiersJson) {
    let rawTiers: unknown
    try {
      rawTiers = JSON.parse(feeTiersJson)
    } catch {
      return { success: false, error: 'Faixas de taxa inválidas' }
    }
    const tiersParsed = z.array(feeTierSchema).min(1).safeParse(rawTiers)
    if (!tiersParsed.success) return { success: false, error: 'Faixas de taxa inválidas' }
    feeTiers = tiersParsed.data
    for (let i = 0; i < feeTiers.length; i++) {
      const isLast = i === feeTiers.length - 1
      if (isLast ? feeTiers[i].maxPrice !== null : feeTiers[i].maxPrice === null) {
        return { success: false, error: 'Só a última faixa pode ficar sem "até" (faixa aberta)' }
      }
      if (!isLast && feeTiers[i].maxPrice! <= (i > 0 ? feeTiers[i - 1].maxPrice! : -Infinity)) {
        return { success: false, error: 'As faixas devem estar em ordem crescente de preço' }
      }
    }
  }

  await prisma.marketplacePlatform.update({
    where: { platform },
    data: { ...fees, ...(feeTiers ? { feeTiers: feeTiers as unknown as Prisma.InputJsonValue } : {}) },
  })
  revalidatePath('/settings')
  return { success: true }
}

// 3.6: prefill do valor unitário sugerido numa venda Shopee/Mercado Livre,
// usando a taxa específica DAQUELA plataforma (em vez do par genérico
// Settings.marketplaceFeePercent/marketplaceFixedFee que o prefill de
// "Marketplace" genérico usava antes). Melhoria "Shopee: taxa por faixa de
// preço": platformConfig.feeTiers presente (Shopee) usa a taxa da faixa
// certa pro preço resultante; ausente (Mercado Livre) continua com a taxa
// única de sempre -- calculatePlatformPrice, sem mudança nenhuma.
export async function getPlatformSalePrice(productId: string, platform: MarketplacePlatformKind): Promise<number> {
  const [breakdown, platformConfig, settings] = await Promise.all([
    getProductCostBreakdown(productId),
    prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])
  const tiers = platformConfig.feeTiers as unknown as PlatformFeeTier[] | null
  if (tiers && tiers.length > 0) {
    return calculateTieredPlatformPrice(breakdown.suggestedPrice, settings.taxPercent.toNumber(), tiers)
  }
  return calculatePlatformPrice(
    breakdown.suggestedPrice,
    settings.taxPercent.toNumber(),
    platformConfig.feePercent.toNumber(),
    platformConfig.feeFixed.toNumber(),
  )
}
