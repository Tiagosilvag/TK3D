import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { updateMarketplacePlatformFees, getPlatformSalePrice } from '@/actions/marketplacePlatforms'
import { getProductCostBreakdown } from '@/actions/products'
import { calculatePlatformPrice, calculateTieredPlatformPrice, type PlatformFeeTier } from '@/lib/costing'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
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

// Melhoria "Shopee: taxa por faixa de preço" -- mesma tabela real seedada
// pela migration 20260917200338_marketplace_platform_fee_tiers.
const shopeeTiers: PlatformFeeTier[] = [
  { maxPrice: 79.99, feePercent: 0.20, feeFixed: 4 },
  { maxPrice: 99.99, feePercent: 0.14, feeFixed: 16 },
  { maxPrice: 199.99, feePercent: 0.14, feeFixed: 20 },
  { maxPrice: 499.99, feePercent: 0.14, feeFixed: 26 },
  { maxPrice: null, feePercent: 0.14, feeFixed: 26 },
]

async function createCheapProduct() {
  const printer = await prisma.printer.create({ data: { name: 'P-barato', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  return prisma.product.create({
    data: {
      name: 'Chaveirinho',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: 10,
      printTimeHours: 0.5,
      laborTimeHours: 0.1,
    },
  })
}

async function createExpensiveProduct() {
  const printer = await prisma.printer.create({ data: { name: 'P-caro', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 5000, currentStockGrams: 5000 } })
  return prisma.product.create({
    data: {
      name: 'Peça grande',
      category: 'Decoração',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: 2000,
      printTimeHours: 60,
      laborTimeHours: 5,
    },
  })
}

describe('marketplacePlatforms actions', () => {
  it('updateMarketplacePlatformFees(SHOPEE) grava feeTiers e espelha a 1ª faixa em feePercent/feeFixed', async () => {
    const result = await updateMarketplacePlatformFees('SHOPEE', fd({
      feePercent: '0.20',
      feeFixed: '4',
      avgFreight: '15',
      feeTiersJson: JSON.stringify(shopeeTiers),
    }))
    expect(result.success).toBe(true)

    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'SHOPEE' } })
    expect(platform.feePercent.toNumber()).toBeCloseTo(0.20)
    expect(platform.feeFixed.toNumber()).toBeCloseTo(4)
    expect(platform.avgFreight.toNumber()).toBeCloseTo(15)
    expect(platform.feeTiers).toEqual(shopeeTiers)
  })

  it('rejeita feeTiers fora de ordem crescente', async () => {
    const badTiers = [
      { maxPrice: 100, feePercent: 0.14, feeFixed: 10 },
      { maxPrice: 50, feePercent: 0.14, feeFixed: 20 },
      { maxPrice: null, feePercent: 0.14, feeFixed: 26 },
    ]
    const result = await updateMarketplacePlatformFees('SHOPEE', fd({
      feePercent: '0.20',
      feeFixed: '4',
      avgFreight: '15',
      feeTiersJson: JSON.stringify(badTiers),
    }))
    expect(result.success).toBe(false)
  })

  it('rejeita feeTiers em que uma faixa antes da última também tem maxPrice null', async () => {
    const badTiers = [
      { maxPrice: null, feePercent: 0.20, feeFixed: 4 },
      { maxPrice: null, feePercent: 0.14, feeFixed: 26 },
    ]
    const result = await updateMarketplacePlatformFees('SHOPEE', fd({
      feePercent: '0.20',
      feeFixed: '4',
      avgFreight: '15',
      feeTiersJson: JSON.stringify(badTiers),
    }))
    expect(result.success).toBe(false)
  })

  it('updateMarketplacePlatformFees(MERCADO_LIVRE) sem feeTiersJson não toca em feeTiers (continua null)', async () => {
    const result = await updateMarketplacePlatformFees('MERCADO_LIVRE', fd({
      feePercent: '0.16',
      feeFixed: '6',
      avgFreight: '20',
    }))
    expect(result.success).toBe(true)

    const platform = await prisma.marketplacePlatform.findUniqueOrThrow({ where: { platform: 'MERCADO_LIVRE' } })
    expect(platform.feePercent.toNumber()).toBeCloseTo(0.16)
    expect(platform.feeFixed.toNumber()).toBeCloseTo(6)
    expect(platform.feeTiers).toBeNull()
  })

  it('getPlatformSalePrice(SHOPEE) usa a faixa certa pra um produto barato (suggestedPrice cai na 1ª faixa)', async () => {
    await updateMarketplacePlatformFees('SHOPEE', fd({
      feePercent: '0.20',
      feeFixed: '4',
      avgFreight: '15',
      feeTiersJson: JSON.stringify(shopeeTiers),
    }))
    const product = await createCheapProduct()
    const breakdown = await getProductCostBreakdown(product.id)
    expect(breakdown.suggestedPrice).toBeLessThan(80)

    const settings = await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
    const expected = calculateTieredPlatformPrice(breakdown.suggestedPrice, settings.taxPercent.toNumber(), shopeeTiers)

    const price = await getPlatformSalePrice(product.id, 'SHOPEE')
    expect(price).toBeCloseTo(expected, 4)
  })

  it('getPlatformSalePrice(SHOPEE) usa a faixa certa pra um produto caro (suggestedPrice acima de R$500)', async () => {
    await updateMarketplacePlatformFees('SHOPEE', fd({
      feePercent: '0.20',
      feeFixed: '4',
      avgFreight: '15',
      feeTiersJson: JSON.stringify(shopeeTiers),
    }))
    const product = await createExpensiveProduct()
    const breakdown = await getProductCostBreakdown(product.id)
    expect(breakdown.suggestedPrice).toBeGreaterThan(500)

    const settings = await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
    const expected = calculateTieredPlatformPrice(breakdown.suggestedPrice, settings.taxPercent.toNumber(), shopeeTiers)
    expect(expected).toBeCloseTo(breakdown.suggestedPrice / (1 - settings.taxPercent.toNumber() - 0.14) + 26, 4)

    const price = await getPlatformSalePrice(product.id, 'SHOPEE')
    expect(price).toBeCloseTo(expected, 4)
  })

  it('getPlatformSalePrice(MERCADO_LIVRE) continua com a taxa única (calculatePlatformPrice), sem faixas', async () => {
    await updateMarketplacePlatformFees('MERCADO_LIVRE', fd({
      feePercent: '0.16',
      feeFixed: '6',
      avgFreight: '20',
    }))
    const product = await createCheapProduct()
    const breakdown = await getProductCostBreakdown(product.id)
    const settings = await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
    const expected = calculatePlatformPrice(breakdown.suggestedPrice, settings.taxPercent.toNumber(), 0.16, 6)

    const price = await getPlatformSalePrice(product.id, 'MERCADO_LIVRE')
    expect(price).toBeCloseTo(expected, 4)
  })
})
