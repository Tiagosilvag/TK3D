'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { calculatePlatformPrice } from '@/lib/costing'
import { getProductCostBreakdown } from './products'
import { revalidatePath } from 'next/cache'
import type { MarketplacePlatformKind } from '@prisma/client'

type ActionResult = { success: boolean; error?: string }

// 4.1: só existem 2 linhas fixas (Shopee/Mercado Livre), seedadas pela
// migration -- este formulário só edita as taxas, nunca cria/remove linhas.
const feesSchema = z.object({
  feePercent: z.coerce.number({ invalid_type_error: 'Taxa inválida' }).min(0, 'Taxa não pode ser negativa').max(1, 'Taxa deve ser uma fração entre 0 e 1'),
  feeFixed: z.coerce.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo'),
  avgFreight: z.coerce.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo'),
})

export async function updateMarketplacePlatformFees(platform: MarketplacePlatformKind, formData: FormData): Promise<ActionResult> {
  const parsed = feesSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  await prisma.marketplacePlatform.update({ where: { platform }, data: parsed.data })
  revalidatePath('/settings/marketplace-platforms')
  return { success: true }
}

// 3.6: prefill do valor unitário sugerido numa venda Shopee/Mercado Livre,
// usando a taxa específica DAQUELA plataforma (em vez do par genérico
// Settings.marketplaceFeePercent/marketplaceFixedFee que o prefill de
// "Marketplace" genérico usava antes).
export async function getPlatformSalePrice(productId: string, platform: MarketplacePlatformKind): Promise<number> {
  const [breakdown, platformConfig, settings] = await Promise.all([
    getProductCostBreakdown(productId),
    prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])
  return calculatePlatformPrice(
    breakdown.suggestedPrice,
    settings.taxPercent.toNumber(),
    platformConfig.feePercent.toNumber(),
    platformConfig.feeFixed.toNumber(),
  )
}
