import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'
import { createListingDraft, updateListing, deleteListing, getListingsPageData } from '@/actions/listings'
import { updateMarketplacePlatformFees, getPlatformSalePrice, resolveSalePlatformFee, resolveSaleFreight } from '@/actions/marketplacePlatforms'
import type { PlatformFeeTier } from '@/lib/costing'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.listing.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { laborCostPerHour: 10, defaultMarkup: 2, energyCostPerKwh: 1, failureRatePercent: 0.1, taxPercent: 0.055 },
    create: { id: 1 },
  })
  await prisma.marketplacePlatform.updateMany({ data: { feeTiers: Prisma.JsonNull, feeTiersPremium: Prisma.JsonNull, categoryReference: null } })
}

beforeAll(async () => {
  await prisma.$connect()
})
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => {
  await prisma.$disconnect()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

const shopeeTiers: PlatformFeeTier[] = [
  { maxPrice: 79.99, feePercent: 0.20, feeFixed: 4 },
  { maxPrice: null, feePercent: 0.14, feeFixed: 26 },
]

const mlClassicoTiers: PlatformFeeTier[] = [{ maxPrice: null, feePercent: 0.12, feeFixed: 0 }]
const mlPremiumTiers: PlatformFeeTier[] = [{ maxPrice: null, feePercent: 0.17, feeFixed: 0 }]

async function createProduct(name = 'Chaveirinho') {
  const printer = await prisma.printer.create({ data: { name: `P-${name}`, purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  return prisma.product.create({
    data: { name, category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 0.5, laborTimeHours: 0.1 },
  })
}

describe('actions/listings', () => {
  it('createListingDraft cria em RASCUNHO com preço/frete pré-preenchidos pela plataforma', async () => {
    await updateMarketplacePlatformFees('SHOPEE', fd({ feePercent: '0.20', feeFixed: '4', avgFreight: '15', feeTiersJson: JSON.stringify(shopeeTiers) }))
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'SHOPEE' } })

    const result = await createListingDraft(product.id, platform.id)
    expect(result.success).toBe(true)

    const listing = await prisma.listing.findFirstOrThrow({ where: { productId: product.id, platformId: platform.id } })
    expect(listing.status).toBe('RASCUNHO')
    expect(listing.freightCost.toNumber()).toBeCloseTo(15)
    expect(listing.price.toNumber()).toBeGreaterThan(0)
    expect(listing.listingType).toBeNull()
  })

  it('createListingDraft recusa um 2º anúncio pro mesmo produto+plataforma (unique constraint)', async () => {
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'SHOPEE' } })
    await createListingDraft(product.id, platform.id)

    const result = await createListingDraft(product.id, platform.id)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/já tem um anúncio/)
  })

  it('bug "mais de 1 anúncio por produto": Mercado Livre permite Clássico + Premium simultâneos, mas recusa duplicar o mesmo tipo', async () => {
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'MERCADO_LIVRE' } })

    const classico = await createListingDraft(product.id, platform.id, 'CLASSICO')
    expect(classico.success).toBe(true)

    const premium = await createListingDraft(product.id, platform.id, 'PREMIUM')
    expect(premium.success).toBe(true)

    const dupClassico = await createListingDraft(product.id, platform.id, 'CLASSICO')
    expect(dupClassico.success).toBe(false)
    expect(dupClassico.error).toMatch(/já tem um anúncio Clássico/)

    const listings = await prisma.listing.findMany({ where: { productId: product.id, platformId: platform.id } })
    expect(listings).toHaveLength(2)
    expect(listings.map((l) => l.listingType).sort()).toEqual(['CLASSICO', 'PREMIUM'])
  })

  it('updateListing recusa trocar o Tipo pra um que já existe no mesmo produto+plataforma', async () => {
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'MERCADO_LIVRE' } })
    await createListingDraft(product.id, platform.id, 'CLASSICO')
    await createListingDraft(product.id, platform.id, 'PREMIUM')
    const classico = await prisma.listing.findFirstOrThrow({ where: { productId: product.id, platformId: platform.id, listingType: 'CLASSICO' } })

    const result = await updateListing(classico.id, fd({
      productId: product.id,
      platformId: platform.id,
      listingType: 'PREMIUM',
      status: 'RASCUNHO',
      price: '50',
      freightType: 'GRATIS_SUBSIDIADO',
      freightCost: '10',
    }))
    expect(result.success).toBe(false)

    const unchanged = await prisma.listing.findUniqueOrThrow({ where: { id: classico.id } })
    expect(unchanged.listingType).toBe('CLASSICO')
  })

  it('updateListing atualiza preço/status/frete/brinde', async () => {
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'SHOPEE' } })
    await createListingDraft(product.id, platform.id)
    const listing = await prisma.listing.findFirstOrThrow({ where: { productId: product.id, platformId: platform.id } })

    const result = await updateListing(listing.id, fd({
      productId: product.id,
      platformId: platform.id,
      status: 'ONLINE',
      price: '42.50',
      freightType: 'PERSONALIZADO',
      freightCost: '6',
      hasGift: 'true',
      giftCost: '0.9',
    }))
    expect(result.success).toBe(true)

    const updated = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })
    expect(updated.status).toBe('ONLINE')
    expect(updated.price.toNumber()).toBeCloseTo(42.5)
    expect(updated.freightType).toBe('PERSONALIZADO')
    expect(updated.freightCost.toNumber()).toBeCloseTo(6)
    expect(updated.hasGift).toBe(true)
    expect(updated.giftCost.toNumber()).toBeCloseTo(0.9)
  })

  it('deleteListing remove o anúncio (o produto volta a aparecer em "sem anúncio")', async () => {
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'SHOPEE' } })
    await createListingDraft(product.id, platform.id)
    const listing = await prisma.listing.findFirstOrThrow({ where: { productId: product.id, platformId: platform.id } })

    await deleteListing(listing.id)
    const data = await getListingsPageData()
    expect(data.productsWithoutListing.some((p) => p.productId === product.id)).toBe(true)
  })

  it('getListingsPageData calcula taxa/lucro corretamente e exclui produtos com anúncio de "sem anúncio"', async () => {
    await updateMarketplacePlatformFees('SHOPEE', fd({ feePercent: '0.20', feeFixed: '4', avgFreight: '15', feeTiersJson: JSON.stringify(shopeeTiers) }))
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'SHOPEE' } })
    await createListingDraft(product.id, platform.id)
    const listing = await prisma.listing.findFirstOrThrow({ where: { productId: product.id, platformId: platform.id } })
    await updateListing(listing.id, fd({ productId: product.id, platformId: platform.id, status: 'ONLINE', price: '50', freightType: 'GRATIS_SUBSIDIADO', freightCost: '4' }))

    const data = await getListingsPageData()
    const row = data.listings.find((r) => r.id === listing.id)!
    expect(row.feePercent).toBeCloseTo(0.20)
    expect(row.feeFixed).toBeCloseTo(4)
    expect(row.feeAmount).toBeCloseTo(50 * 0.20 + 4)
    expect(row.profit).toBeCloseTo(50 - row.productionCost - row.feeAmount - 4)
    expect(data.productsWithoutListing.some((p) => p.productId === product.id)).toBe(false)
    expect(data.metrics.activeCount).toBe(1)
  })

  it('ML: listingType PREMIUM usa feeTiersPremium, CLASSICO/null usa feeTiers', async () => {
    await updateMarketplacePlatformFees('MERCADO_LIVRE', fd({
      feePercent: '0.12',
      feeFixed: '0',
      avgFreight: '10',
      feeTiersJson: JSON.stringify(mlClassicoTiers),
      feeTiersPremiumJson: JSON.stringify(mlPremiumTiers),
    }))
    const product = await createProduct('Boneco ML')
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'MERCADO_LIVRE' } })
    await createListingDraft(product.id, platform.id, 'PREMIUM')
    const listing = await prisma.listing.findFirstOrThrow({ where: { productId: product.id, platformId: platform.id } })
    expect(listing.listingType).toBe('PREMIUM')

    const data = await getListingsPageData()
    const row = data.listings.find((r) => r.id === listing.id)!
    expect(row.feePercent).toBeCloseTo(0.17)
  })

  it('getPlatformSalePrice prefere um Listing existente (preço/taxa reais) em vez do cálculo genérico', async () => {
    await updateMarketplacePlatformFees('SHOPEE', fd({ feePercent: '0.20', feeFixed: '4', avgFreight: '15', feeTiersJson: JSON.stringify(shopeeTiers) }))
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'SHOPEE' } })
    await createListingDraft(product.id, platform.id)
    const listing = await prisma.listing.findFirstOrThrow({ where: { productId: product.id, platformId: platform.id } })
    await updateListing(listing.id, fd({ productId: product.id, platformId: platform.id, status: 'ONLINE', price: '999', freightType: 'GRATIS_SUBSIDIADO', freightCost: '4' }))

    const result = await getPlatformSalePrice(product.id, 'SHOPEE')
    expect(result.price).toBeCloseTo(999)
    expect(result.feePercent).toBeCloseTo(0.14)
    expect(result.feeFixed).toBeCloseTo(26)
  })

  it('resolveSaleFreight prefere o frete real do Listing quando existe', async () => {
    await updateMarketplacePlatformFees('SHOPEE', fd({ feePercent: '0.20', feeFixed: '4', avgFreight: '15', feeTiersJson: JSON.stringify(shopeeTiers) }))
    const product = await createProduct()
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'SHOPEE' } })
    await createListingDraft(product.id, platform.id)
    const listing = await prisma.listing.findFirstOrThrow({ where: { productId: product.id, platformId: platform.id } })
    await updateListing(listing.id, fd({ productId: product.id, platformId: platform.id, status: 'ONLINE', price: '999', freightType: 'GRATIS_SUBSIDIADO', freightCost: '6.5' }))

    expect(await resolveSaleFreight('SHOPEE', product.id)).toBeCloseTo(6.5)
  })

  it('resolveSaleFreight cai na média da plataforma quando não há Listing', async () => {
    await updateMarketplacePlatformFees('SHOPEE', fd({ feePercent: '0.20', feeFixed: '4', avgFreight: '15', feeTiersJson: JSON.stringify(shopeeTiers) }))
    const product = await createProduct()

    expect(await resolveSaleFreight('SHOPEE', product.id)).toBeCloseTo(15)
  })

  it('resolveSaleFreight devolve 0 pra canal Direta (sem frete rastreado)', async () => {
    const product = await createProduct('Produto Direta')
    expect(await resolveSaleFreight('DIRETA', product.id)).toBe(0)
  })

  it('resolveSalePlatformFee(productId) usa o listingType do Listing pra escolher Clássico/Premium', async () => {
    await updateMarketplacePlatformFees('MERCADO_LIVRE', fd({
      feePercent: '0.12',
      feeFixed: '0',
      avgFreight: '10',
      feeTiersJson: JSON.stringify(mlClassicoTiers),
      feeTiersPremiumJson: JSON.stringify(mlPremiumTiers),
    }))
    const product = await createProduct('Boneco ML 2')
    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'MERCADO_LIVRE' } })
    await createListingDraft(product.id, platform.id, 'PREMIUM')

    const fee = await resolveSalePlatformFee('MERCADO_LIVRE', 100, product.id)
    expect(fee?.feePercent).toBeCloseTo(0.17)

    // Sem productId (comportamento de sempre): cai em Clássico/feeTiers.
    const feeWithoutProduct = await resolveSalePlatformFee('MERCADO_LIVRE', 100)
    expect(feeWithoutProduct?.feePercent).toBeCloseTo(0.12)
  })
})
