'use server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import type { ListingStatus, ListingFreightType, ListingType, ListingFormat, MarketplacePlatformKind } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { listingSchema, listingKitItemSchema } from '@/lib/validation/listing'
import { resolveListingFee, resolvePlatformPrice, calculateListingProfit, resolveListingTiers, type PlatformPriceBreakdown, type ProductCostBreakdown, type PlatformFeeTier } from '@/lib/costing'
import { getProductVariantBreakdown } from '@/lib/reports'
import { productNeedsAssembly } from '@/lib/products'
import { getPlatformSalePrice } from './marketplacePlatforms'
import { getProductCostBreakdown } from './products'
import { resolveOrderItemColorLabel } from './orders'
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

// Melhoria "Anúncios: Unidade/Variação/Kit": o produto escolhido no passo
// "Variação" do formulário precisa ter pelo menos 1 combo de cor conhecido
// (produzido alguma vez) pra ter o que marcar -- em vez de pré-filtrar o
// <select> de produto inteiro (custaria calcular a quebra de variante de
// TODO produto vendável só pra montar essa lista, cada carregamento da
// tela), a tela deixa escolher qualquer produto vendável e só valida/
// mostra a lista de combos DEPOIS de escolhido (esta função), retornando
// vazio quando o produto não tem variante nenhuma -- a tela então avisa
// em vez de deixar prosseguir.
export async function getListingProductVariantOptions(productId: string): Promise<{ key: string; label: string; colorHex: string | null }[]> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
  })
  const needsAssembly = productNeedsAssembly({
    isComposite: product.isComposite,
    accessoryUsagesCount: product._count.accessoryUsages,
    supplyUsagesCount: product._count.supplyUsages,
    componentUsagesCount: product._count.componentUsages,
  })
  const breakdown = await getProductVariantBreakdown(productId, needsAssembly)
  return breakdown.map((v) => ({ key: v.key, label: v.label, colorHex: v.colorHex }))
}

const createDraftSchema = z.object({
  format: z.enum(['UNIDADE', 'VARIACAO', 'KIT']).default('UNIDADE'),
  productId: z.string().optional().nullable(),
  platformId: z.string().min(1, 'Selecione uma plataforma'),
  listingType: z.enum(['CLASSICO', 'PREMIUM']).optional().nullable(),
  includedVariantKeys: z.array(z.string().min(1)).optional(),
  kitName: z.string().optional().nullable(),
  kitItems: z.array(listingKitItemSchema).optional(),
})

// Melhoria "Anúncios: Unidade/Variação/Kit": createListingDraft deixou de
// ser "1 clique" só pra Unidade -- Variação (escolher quais combos) e Kit
// (montar a lista de itens) precisam de um formulário de verdade antes de
// criar (NewListingDialog), então passou a receber os campos já resolvidos
// em JS (chamada direta client→server action, não um <form action>, então
// não precisa do dance de FormData/JSON string que createOrder usa).
// Continua nascendo em RASCUNHO, com preço/frete pré-preenchidos quando dá
// (Unidade/Variação usam getPlatformSalePrice do productId; Kit não tem 1
// produto só pra sugerir preço, nasce com preço 0 pro vendedor definir).
export async function createListingDraft(input: {
  format?: 'UNIDADE' | 'VARIACAO' | 'KIT'
  productId?: string | null
  platformId: string
  listingType?: 'CLASSICO' | 'PREMIUM' | null
  includedVariantKeys?: string[]
  kitName?: string | null
  kitItems?: { productId: string; quantity: number }[]
}): Promise<ActionResult> {
  const parsed = createDraftSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const data = parsed.data

  const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { id: data.platformId } })
  const resolvedType = platform.platform === 'MERCADO_LIVRE' ? data.listingType ?? null : null

  if (data.format === 'KIT') {
    if (!data.kitName?.trim()) return { success: false, error: 'Nome do kit é obrigatório' }
    if (!data.kitItems || data.kitItems.length === 0) return { success: false, error: 'Adicione pelo menos 1 item ao kit' }
    const ids = data.kitItems.map((i) => i.productId)
    if (new Set(ids).size !== ids.length) return { success: false, error: 'Um produto não pode aparecer duas vezes no mesmo kit' }
    const products = await prisma.product.findMany({ where: { id: { in: ids } } })
    const productById = new Map(products.map((p) => [p.id, p]))
    for (const item of data.kitItems) {
      const product = productById.get(item.productId)
      if (!product) return { success: false, error: 'Produto do kit não encontrado' }
      if (!product.active || product.isGift) return { success: false, error: `${product.name} não pode entrar num kit (inativo ou é brinde)` }
    }

    await prisma.listing.create({
      data: {
        format: 'KIT',
        kitName: data.kitName.trim(),
        platformId: data.platformId,
        listingType: resolvedType,
        status: 'RASCUNHO',
        price: 0,
        freightType: 'GRATIS_SUBSIDIADO',
        freightCost: platform.avgFreight,
        kitItems: { create: data.kitItems.map((i) => ({ productId: i.productId, quantity: i.quantity })) },
      },
    })
    revalidatePath('/listings')
    return { success: true }
  }

  if (!data.productId) return { success: false, error: 'Selecione um produto' }

  if (data.format === 'VARIACAO') {
    if (!data.includedVariantKeys || data.includedVariantKeys.length === 0) {
      return { success: false, error: 'Marque pelo menos 1 variação pra incluir no anúncio' }
    }
    const options = await getListingProductVariantOptions(data.productId)
    const validKeys = new Set(options.map((o) => o.key))
    if (!data.includedVariantKeys.every((k) => validKeys.has(k))) {
      return { success: false, error: 'Variação inválida pra este produto' }
    }
  }

  const suggested = await getPlatformSalePrice(data.productId, platform.platform, resolvedType ?? undefined)

  try {
    await prisma.listing.create({
      data: {
        format: data.format,
        productId: data.productId,
        platformId: data.platformId,
        listingType: resolvedType,
        status: 'RASCUNHO',
        price: suggested.price,
        freightType: 'GRATIS_SUBSIDIADO',
        freightCost: platform.avgFreight,
        includedVariantKeys: data.format === 'VARIACAO' ? data.includedVariantKeys : undefined,
      },
    })
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Melhoria "mais de 1 anúncio por produto": Mercado Livre permite 1
      // Clássico + 1 Premium do mesmo produto ao mesmo tempo (2 índices
      // únicos parciais, ver schema.prisma) -- só bate duplicata dentro do
      // MESMO tipo (ou em Shopee, que não tem tipo pra distinguir).
      return {
        success: false,
        error: resolvedType
          ? `Esse produto já tem um anúncio ${resolvedType === 'CLASSICO' ? 'Clássico' : 'Premium'} nessa plataforma — edite o existente.`
          : 'Esse produto já tem um anúncio nessa plataforma — edite o existente.',
      }
    }
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

  try {
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
  } catch (err) {
    // Trocar o Tipo (Clássico <-> Premium) inline (ListingRow.tsx) pode
    // esbarrar num anúncio que já existe com o tipo de destino -- mesmo
    // índice único parcial de createListingDraft, mesma mensagem amigável.
    if (isUniqueConstraintError(err)) {
      return { success: false, error: 'Esse produto já tem um anúncio com esse tipo nessa plataforma — edite o existente em vez de duplicar.' }
    }
    throw err
  }
  revalidatePath('/listings')
  return { success: true }
}

export async function deleteListing(id: string): Promise<ActionResult> {
  await prisma.listing.delete({ where: { id } })
  revalidatePath('/listings')
  return { success: true }
}

// Melhoria "Anúncios: Unidade/Variação/Kit": só populado pra format
// VARIACAO (variantes do productId incluídas neste anúncio específico) ou
// KIT (itens do conjunto) respectivamente -- [] no outro caso, nunca null,
// pra tabela não precisar de 2 checagens (`format === X` E `!= null`).
export type ListingVariantInfo = { key: string; label: string; colorHex: string | null }
export type ListingKitItemRow = { productId: string; productName: string; quantity: number; unitCost: number }

export type ListingRow = {
  id: string
  format: ListingFormat
  // Nulo só pra format KIT (o anúncio representa vários produtos, ver
  // kitItems abaixo) -- productName cai pro kitName nesse caso.
  productId: string | null
  productName: string
  productCategory: string | null
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
  includedVariants: ListingVariantInfo[]
  kitItems: ListingKitItemRow[]
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
  // Melhoria "Anúncios: Kit": productionCost junto pra montagem calcular o
  // total do kit ao vivo no cliente, sem round-trip por item alterado.
  allProducts: { id: string; name: string; productionCost: number }[]
  // Melhoria "Anúncios: calculadora de preço pelo lucro desejado": taxa%/
  // fixa/faixas de cada plataforma, pra recalcular taxa/lucro ao vivo no
  // cliente conforme o vendedor ajusta preço/lucro desejado no painel de
  // edição, sem round-trip por tecla -- calculateListingPriceForDesiredProfit/
  // resolveListingFee (lib/costing.ts) são funções puras, seguras de
  // importar direto num Client Component.
  platforms: {
    id: string
    kind: MarketplacePlatformKind
    feePercent: number
    feeFixed: number
    feeTiers: PlatformFeeTier[] | null
    feeTiersPremium: PlatformFeeTier[] | null
  }[]
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
    prisma.listing.findMany({
      include: { product: true, platform: true, kitItems: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.findMany({ where: { ...SELLABLE_PRODUCT_WHERE, listings: { none: {} } }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: SELLABLE_PRODUCT_WHERE, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])

  // Custo de produção é caro de recalcular (soma peças/insumos/acessórios) --
  // 1 chamada por produto único referenciado nesta tela, nunca 1 por linha,
  // já que o mesmo produto pode ter Listing em Shopee E Mercado Livre ao
  // mesmo tempo, ou aparecer dentro de um Kit alheio. Inclui os productId
  // dos itens de kit (formato KIT não tem productId próprio, mas cada item
  // dele tem).
  const productIds = new Set([
    ...listings.flatMap((l) => (l.productId ? [l.productId] : l.kitItems.map((i) => i.productId))),
    ...productsWithoutListingRaw.map((p) => p.id),
  ])
  const breakdownEntries = await Promise.all([...productIds].map(async (id) => [id, await getProductCostBreakdown(id)] as const))
  const breakdownByProduct = new Map<string, ProductCostBreakdown>(breakdownEntries)

  // Melhoria "Anúncios: Variação": labels/colorHex das variantes incluídas
  // -- 1 chamada por produto único referenciado por algum anúncio VARIACAO
  // (mesmo padrão de custo acima), nunca 1 por linha.
  const variacaoProductIds = new Set(listings.filter((l) => l.format === 'VARIACAO' && l.productId).map((l) => l.productId as string))
  const variantOptionsEntries = await Promise.all([...variacaoProductIds].map(async (id) => [id, await getListingProductVariantOptions(id)] as const))
  const variantOptionsByProduct = new Map(variantOptionsEntries)

  const listingRows: ListingRow[] = await Promise.all(listings.map(async (l) => {
    const isKit = l.format === 'KIT'
    const productionCost = isKit
      ? l.kitItems.reduce((sum, item) => sum + item.quantity * (breakdownByProduct.get(item.productId)?.finalCost ?? 0), 0)
      : (breakdownByProduct.get(l.productId!)?.finalCost ?? 0)
    const price = l.price.toNumber()
    const tiers = resolveListingTiers(l.platform, l.listingType)
    const { feePercent, feeFixed, feeAmount } = resolveListingFee(price, tiers, l.platform.feePercent.toNumber(), l.platform.feeFixed.toNumber())
    const freightCost = l.freightCost.toNumber()
    const giftCost = l.hasGift ? l.giftCost.toNumber() : 0
    const profit = calculateListingProfit({ price, productionCost, feeAmount, freightCost, giftCost })

    let includedVariants: ListingVariantInfo[] = []
    if (l.format === 'VARIACAO' && l.productId) {
      const keys = (l.includedVariantKeys as string[] | null) ?? []
      const options = variantOptionsByProduct.get(l.productId) ?? []
      includedVariants = await Promise.all(keys.map(async (key): Promise<ListingVariantInfo> => {
        const known = options.find((o) => o.key === key)
        if (known) return known
        // Combo não encontrado no produzido atual (ex.: cor renomeada
        // depois) -- resolve pelo catálogo inteiro em vez de esconder a
        // variante do anúncio (mesma função que Pedidos já usa pra esse
        // exato caso).
        const fallback = await resolveOrderItemColorLabel(l.productId!, key)
        return { key, label: fallback?.label ?? key, colorHex: fallback?.colorHex ?? null }
      }))
    }

    return {
      id: l.id,
      format: l.format,
      productId: l.productId,
      productName: isKit ? (l.kitName ?? '') : l.product!.name,
      productCategory: isKit ? null : l.product!.category,
      platformId: l.platformId,
      platformKind: l.platform.platform,
      listingType: l.listingType,
      status: l.status,
      price,
      productionCost,
      feePercent,
      feeFixed,
      feeAmount,
      freightType: l.freightType,
      freightCost,
      hasGift: l.hasGift,
      giftCost,
      listingUrl: l.listingUrl,
      profit,
      includedVariants,
      kitItems: l.kitItems.map((i) => ({
        productId: i.productId,
        productName: i.product.name,
        quantity: i.quantity,
        unitCost: breakdownByProduct.get(i.productId)?.finalCost ?? 0,
      })),
    }
  }))

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
    allProducts: allProducts.map((p) => ({ id: p.id, name: p.name, productionCost: breakdownByProduct.get(p.id)?.finalCost ?? 0 })),
    platforms: platforms.map((p) => ({
      id: p.id,
      kind: p.platform,
      feePercent: p.feePercent.toNumber(),
      feeFixed: p.feeFixed.toNumber(),
      feeTiers: (p.feeTiers as PlatformFeeTier[] | null) ?? null,
      feeTiersPremium: (p.feeTiersPremium as PlatformFeeTier[] | null) ?? null,
    })),
    metrics: {
      activeCount,
      productsWithoutListingCount: productsWithoutListing.length,
      avgProfit,
      lowMarginCount,
    },
  }
}
