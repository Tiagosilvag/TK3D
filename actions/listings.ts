'use server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { ListingStatus, ListingFreightType, ListingType, MarketplacePlatformKind } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { listingSchema } from '@/lib/validation/listing'
import { resolveListingFee, resolvePlatformPrice, calculateListingProfit, resolveListingTiers, type PlatformPriceBreakdown, type ProductCostBreakdown } from '@/lib/costing'
import { getPlatformSalePrice } from './marketplacePlatforms'
import { getProductCostBreakdown } from './products'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// Anúncios: mesma checagem que o resto do app já faz em toda lista de
// produtos pra vender/produzir (CLAUDE.md "Exclude isGift from 8 existing
// product picker queries") -- Brinde nunca aparece aqui, não é vendido
// sozinho.
const SELLABLE_PRODUCT_WHERE = { active: true, isGift: false } as const

const createDraftSchema = z.object({
  productId: z.string().min(1, 'Selecione um produto'),
  platformId: z.string().min(1, 'Selecione uma plataforma'),
  listingType: z.enum(['CLASSICO', 'PREMIUM']).optional(),
})

// Anúncios: criação = 1 clique ("+ Criar anúncio" / "+ Novo anúncio"), sem
// formulário próprio pra cada campo -- nasce em RASCUNHO com preço
// pré-preenchido pelo Sugerido daquela plataforma (getPlatformSalePrice) e
// frete = MarketplacePlatform.avgFreight, tudo editável depois inline na
// tabela (updateListing). Mesmo espírito do protótipo de referência.
export async function createListingDraft(productId: string, platformId: string, listingType?: 'CLASSICO' | 'PREMIUM'): Promise<ActionResult> {
  const parsed = createDraftSchema.safeParse({ productId, platformId, listingType })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { id: platformId } })
  const resolvedType = platform.platform === 'MERCADO_LIVRE' ? parsed.data.listingType ?? null : null
  const suggested = await getPlatformSalePrice(productId, platform.platform, resolvedType ?? undefined)

  try {
    await prisma.listing.create({
      data: {
        productId,
        platformId,
        listingType: resolvedType,
        status: 'RASCUNHO',
        price: suggested.price,
        freightType: 'GRATIS_SUBSIDIADO',
        freightCost: platform.avgFreight,
      },
    })
  } catch (err) {
    if (isUniqueConstraintError(err)) return { success: false, error: 'Esse produto já tem um anúncio nessa plataforma — edite o existente.' }
    throw err
  }
  revalidatePath('/listings')
  return { success: true }
}

export async function updateListing(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = listingSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const data = parsed.data

  const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { id: data.platformId } })
  if (platform.platform !== 'MERCADO_LIVRE' && data.listingType) {
    return { success: false, error: 'Tipo de anúncio só existe pra Mercado Livre' }
  }

  await prisma.listing.update({
    where: { id },
    data: {
      listingType: platform.platform === 'MERCADO_LIVRE' ? data.listingType ?? null : null,
      status: data.status,
      price: data.price,
      freightType: data.freightType,
      freightCost: data.freightCost,
      hasGift: data.hasGift,
      giftCost: data.hasGift ? data.giftCost : 0,
      listingUrl: data.listingUrl,
    },
  })
  revalidatePath('/listings')
  return { success: true }
}

export async function deleteListing(id: string): Promise<ActionResult> {
  await prisma.listing.delete({ where: { id } })
  revalidatePath('/listings')
  return { success: true }
}

export type ListingRow = {
  id: string
  productId: string
  productName: string
  productCategory: string
  platformId: string
  platformKind: MarketplacePlatformKind
  listingType: ListingType | null
  status: ListingStatus
  price: number
  productionCost: number
  feePercent: number
  feeFixed: number
  feeAmount: number
  freightType: ListingFreightType
  freightCost: number
  hasGift: boolean
  giftCost: number
  listingUrl: string | null
  profit: number
}

export type ProductWithoutListing = {
  productId: string
  productName: string
  productCategory: string
  productionCost: number
  suggestedShopee: number | null
  suggestedMlClassico: number | null
  suggestedMlPremium: number | null
}

export type ListingsPageData = {
  listings: ListingRow[]
  productsWithoutListing: ProductWithoutListing[]
  // Anúncios: lista completa de produtos vendáveis (não só os sem
  // anúncio) -- alimenta o seletor de produto do "+ Novo anúncio" no
  // toolbar, já que um produto pode ganhar um 2º anúncio (outra
  // plataforma) mesmo já tendo um em Shopee, por exemplo.
  allProducts: { id: string; name: string }[]
  platforms: { id: string; kind: MarketplacePlatformKind }[]
  metrics: {
    activeCount: number
    productsWithoutListingCount: number
    avgProfit: number
    lowMarginCount: number
  }
}

// Anúncios: 1 função server-side que devolve tudo que /listings precisa --
// mesmo padrão de outras telas (getOwnStockSummary, getOrderDemandQueue).
// Métricas sempre sobre o conjunto COMPLETO de anúncios (não filtrado) --
// os filtros da toolbar (Plataforma/Status/Busca) são só client-side sobre
// a tabela, mesmo comportamento do protótipo de referência.
export async function getListingsPageData(): Promise<ListingsPageData> {
  const [settings, platforms, listings, productsWithoutListingRaw, allProducts] = await Promise.all([
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.marketplacePlatform.findMany(),
    prisma.listing.findMany({ include: { product: true, platform: true }, orderBy: { createdAt: 'desc' } }),
    prisma.product.findMany({ where: { ...SELLABLE_PRODUCT_WHERE, listings: { none: {} } }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: SELLABLE_PRODUCT_WHERE, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])

  // Custo de produção é caro de recalcular (soma peças/insumos/acessórios) --
  // 1 chamada por produto único referenciado nesta tela, nunca 1 por linha,
  // já que o mesmo produto pode ter Listing em Shopee E Mercado Livre ao
  // mesmo tempo.
  const productIds = new Set([...listings.map((l) => l.productId), ...productsWithoutListingRaw.map((p) => p.id)])
  const breakdownEntries = await Promise.all([...productIds].map(async (id) => [id, await getProductCostBreakdown(id)] as const))
  const breakdownByProduct = new Map<string, ProductCostBreakdown>(breakdownEntries)

  const listingRows: ListingRow[] = listings.map((l) => {
    const breakdown = breakdownByProduct.get(l.productId)!
    const price = l.price.toNumber()
    const tiers = resolveListingTiers(l.platform, l.listingType)
    const { feePercent, feeFixed, feeAmount } = resolveListingFee(price, tiers, l.platform.feePercent.toNumber(), l.platform.feeFixed.toNumber())
    const freightCost = l.freightCost.toNumber()
    const giftCost = l.hasGift ? l.giftCost.toNumber() : 0
    const profit = calculateListingProfit({ price, productionCost: breakdown.finalCost, feeAmount, freightCost, giftCost })
    return {
      id: l.id,
      productId: l.productId,
      productName: l.product.name,
      productCategory: l.product.category,
      platformId: l.platformId,
      platformKind: l.platform.platform,
      listingType: l.listingType,
      status: l.status,
      price,
      productionCost: breakdown.finalCost,
      feePercent,
      feeFixed,
      feeAmount,
      freightType: l.freightType,
      freightCost,
      hasGift: l.hasGift,
      giftCost,
      listingUrl: l.listingUrl,
      profit,
    }
  })

  const shopeePlatform = platforms.find((p) => p.platform === 'SHOPEE')
  const mlPlatform = platforms.find((p) => p.platform === 'MERCADO_LIVRE')
  const taxPercent = settings.taxPercent.toNumber()
  function suggestedFor(breakdown: ProductCostBreakdown, platform: typeof shopeePlatform, listingType?: ListingType): number | null {
    if (!platform) return null
    const tiers = resolveListingTiers(platform, listingType)
    const result: PlatformPriceBreakdown = resolvePlatformPrice(breakdown.suggestedPrice, taxPercent, platform.feePercent.toNumber(), platform.feeFixed.toNumber(), tiers)
    return result.price
  }

  const productsWithoutListing: ProductWithoutListing[] = productsWithoutListingRaw.map((p) => {
    const breakdown = breakdownByProduct.get(p.id)!
    return {
      productId: p.id,
      productName: p.name,
      productCategory: p.category,
      productionCost: breakdown.finalCost,
      suggestedShopee: suggestedFor(breakdown, shopeePlatform),
      suggestedMlClassico: suggestedFor(breakdown, mlPlatform, 'CLASSICO'),
      suggestedMlPremium: suggestedFor(breakdown, mlPlatform, 'PREMIUM'),
    }
  })

  const activeCount = listingRows.filter((r) => r.status === 'ONLINE').length
  const avgProfit = listingRows.length ? listingRows.reduce((sum, r) => sum + r.profit, 0) / listingRows.length : 0
  const lowMarginCount = listingRows.filter((r) => r.price > 0 && r.profit / r.price < 0.2).length

  return {
    listings: listingRows,
    productsWithoutListing,
    allProducts: allProducts.map((p) => ({ id: p.id, name: p.name })),
    platforms: platforms.map((p) => ({ id: p.id, kind: p.platform })),
    metrics: {
      activeCount,
      productsWithoutListingCount: productsWithoutListing.length,
      avgProfit,
      lowMarginCount,
    },
  }
}
