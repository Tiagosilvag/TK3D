import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  getRevenueByChannel,
  getTotalWasteCost,
  getTopProducts,
  getConsignmentStockSummary,
  getConsignmentRevenue,
} from '@/lib/reports'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  // Children before parents, matching the FK-ordering discipline used across
  // the other integration test suites.
  await prisma.consignmentSaleReport.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productSupplyUsage.deleteMany()
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

async function createSupportRecords() {
  const printer = await prisma.printer.create({ data: { name: 'P', purchasePrice: 1, depreciationHours: 1, avgPowerConsumptionKwh: 0.1 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F', diameterMm: 1.75, spoolPrice: 100, spoolWeightKg: 1, densityGCm3: 1.2, nozzleTempC: 200, bedTempC: 60 } })
  const product = await prisma.product.create({ data: { name: 'X', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 } })
  return { printer, filament, product }
}

describe('getRevenueByChannel', () => {
  it('soma receita por canal corretamente', async () => {
    const { product } = await createSupportRecords()
    await prisma.sale.create({ data: { channel: 'DIRETA', productId: product.id, quantity: 2, unitPrice: 10, saleDate: new Date() } })
    await prisma.sale.create({ data: { channel: 'MARKETPLACE', productId: product.id, quantity: 1, unitPrice: 20, saleDate: new Date() } })

    const result = await getRevenueByChannel()
    expect(result.DIRETA).toBeCloseTo(20, 2)
    expect(result.MARKETPLACE).toBeCloseTo(20, 2)
  })

  it('retorna zero para os dois canais quando não há vendas', async () => {
    const result = await getRevenueByChannel()
    expect(result).toEqual({ DIRETA: 0, MARKETPLACE: 0 })
  })
})

describe('getTotalWasteCost', () => {
  it('soma o custo de desperdício de todas as execuções de produção', async () => {
    const { printer, filament, product } = await createSupportRecords()
    await prisma.settings.upsert({ where: { id: 1 }, update: { energyCostPerKwh: 1 }, create: { id: 1, energyCostPerKwh: 1 } })

    await prisma.productionRun.create({
      data: {
        productId: product.id,
        printerId: printer.id,
        filamentId: filament.id,
        date: new Date(),
        quantityPlanned: 10,
        quantitySuccess: 8,
        quantityFailed: 2,
        gramsWasted: 100,
        timeWastedHours: 1,
      },
    })

    // printerDepreciationCostPerHour = 1 / 1 = 1 (maintenance is no longer folded
    // into depreciation; getTotalWasteCost's time-waste-cost term is depreciation
    // + energy only, unchanged by the printer costing rework)
    // filamentPricePerKg = 100 / 1 = 100
    // filamentWasteCost = 100g * (100/1000) = 10
    // timeWasteCost = 1h * (1 + 1*0.1) = 1.1
    // total = 11.1
    const total = await getTotalWasteCost()
    expect(total).toBeCloseTo(11.1, 2)
  })

  it('retorna zero quando não há execuções de produção', async () => {
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
    const total = await getTotalWasteCost()
    expect(total).toBe(0)
  })
})

describe('getTopProducts', () => {
  it('retorna os produtos mais vendidos em ordem decrescente de quantidade', async () => {
    const { printer, filament } = await createSupportRecords()
    const productA = await prisma.product.create({ data: { name: 'A', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 } })
    const productB = await prisma.product.create({ data: { name: 'B', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 } })

    await prisma.sale.create({ data: { channel: 'DIRETA', productId: productA.id, quantity: 3, unitPrice: 10, saleDate: new Date() } })
    await prisma.sale.create({ data: { channel: 'MARKETPLACE', productId: productB.id, quantity: 10, unitPrice: 10, saleDate: new Date() } })

    const top = await getTopProducts(5)
    expect(top).toHaveLength(2)
    expect(top[0].product.id).toBe(productB.id)
    expect(top[0].quantitySold).toBe(10)
    expect(top[1].product.id).toBe(productA.id)
    expect(top[1].quantitySold).toBe(3)
  })

  it('respeita o limite informado', async () => {
    const { printer, filament } = await createSupportRecords()
    for (let i = 0; i < 7; i++) {
      const p = await prisma.product.create({ data: { name: `P${i}`, printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 } })
      await prisma.sale.create({ data: { channel: 'DIRETA', productId: p.id, quantity: i + 1, unitPrice: 10, saleDate: new Date() } })
    }
    const top = await getTopProducts(5)
    expect(top).toHaveLength(5)
  })
})

describe('getConsignmentRevenue', () => {
  it('soma o repasse (quantidade * preço unitário * (1 - comissão)) de todos os relatórios de venda', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })

    const deliveryA = await prisma.consignmentDelivery.create({
      data: { partnerId: partner.id, productId: product.id, quantityDelivered: 10, unitPrice: 25, deliveryDate: new Date() },
    })
    await prisma.consignmentSaleReport.create({
      data: { deliveryId: deliveryA.id, quantitySold: 4, reportDate: new Date(), commissionPercent: 0.3 },
    })

    const deliveryB = await prisma.consignmentDelivery.create({
      data: { partnerId: partner.id, productId: product.id, quantityDelivered: 5, unitPrice: 50, deliveryDate: new Date() },
    })
    await prisma.consignmentSaleReport.create({
      data: { deliveryId: deliveryB.id, quantitySold: 2, reportDate: new Date(), commissionPercent: 0.2 },
    })

    // deliveryA: 4 * 25 * (1 - 0.3) = 70
    // deliveryB: 2 * 50 * (1 - 0.2) = 80
    // total = 150
    const total = await getConsignmentRevenue()
    expect(total).toBeCloseTo(150, 2)
  })

  it('retorna zero quando não há relatórios de venda', async () => {
    const total = await getConsignmentRevenue()
    expect(total).toBe(0)
  })
})

describe('getConsignmentStockSummary', () => {
  it('retorna o saldo restante em consignação por parceiro e produto, ocultando saldo zerado', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })

    const deliveryWithBalance = await prisma.consignmentDelivery.create({
      data: { partnerId: partner.id, productId: product.id, quantityDelivered: 10, unitPrice: 25, deliveryDate: new Date() },
    })
    await prisma.consignmentSaleReport.create({
      data: { deliveryId: deliveryWithBalance.id, quantitySold: 4, reportDate: new Date(), commissionPercent: 0.3 },
    })

    const deliveryFullySold = await prisma.consignmentDelivery.create({
      data: { partnerId: partner.id, productId: product.id, quantityDelivered: 5, unitPrice: 25, deliveryDate: new Date() },
    })
    await prisma.consignmentSaleReport.create({
      data: { deliveryId: deliveryFullySold.id, quantitySold: 5, reportDate: new Date(), commissionPercent: 0.3 },
    })

    const summary = await getConsignmentStockSummary()
    expect(summary).toEqual([
      { partnerName: 'Loja', productName: product.name, remaining: 6 },
    ])
  })
})
