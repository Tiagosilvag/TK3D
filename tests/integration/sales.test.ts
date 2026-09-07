import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createSale } from '@/actions/sales'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  // Sale references Product, which references Printer/Filament, so it must
  // be wiped before those parent tables (children before parents), matching
  // the discipline in productionRuns.test.ts.
  await prisma.sale.deleteMany()
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

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

async function createSupportRecords() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const product = await prisma.product.create({
    data: {
      name: 'Chaveirinho',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.25,
    },
  })
  return { printer, filament, product }
}

describe('sales actions', () => {
  it('cria uma venda direta válida', async () => {
    const { product } = await createSupportRecords()

    const result = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '2',
      unitPrice: '35.00',
      saleDate: '2026-09-01',
      buyerOrPlatform: 'Maria',
    }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(sale.channel).toBe('DIRETA')
    expect(sale.quantity).toBe(2)
    expect(sale.unitPrice.toNumber()).toBe(35)
    expect(sale.buyerOrPlatform).toBe('Maria')
  })

  it('cria uma venda de marketplace válida', async () => {
    const { product } = await createSupportRecords()

    const result = await createSale(fd({
      channel: 'MARKETPLACE',
      productId: product.id,
      quantity: '1',
      unitPrice: '42.90',
      saleDate: '2026-09-02',
      buyerOrPlatform: 'Shopee',
    }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(sale.channel).toBe('MARKETPLACE')
    expect(sale.quantity).toBe(1)
    expect(sale.unitPrice.toNumber()).toBe(42.9)
  })

  it('rejeita quantidade zero ou negativa', async () => {
    const { product } = await createSupportRecords()

    const zero = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '0',
      unitPrice: '35.00',
      saleDate: '2026-09-01',
    }))
    expect(zero.success).toBe(false)

    const negative = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '-3',
      unitPrice: '35.00',
      saleDate: '2026-09-01',
    }))
    expect(negative.success).toBe(false)

    const count = await prisma.sale.count({ where: { productId: product.id } })
    expect(count).toBe(0)
  })
})
