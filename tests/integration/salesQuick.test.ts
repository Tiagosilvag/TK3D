import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createSale, updateSaleQuantityPrice, getSaleProfit } from '@/actions/sales'
import { createOrder, deliverOrderItem, undoOrderItemDelivery } from '@/actions/orders'
import { createProductionRun } from '@/actions/productionRuns'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.stockConsumption.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productPackagingUsage.deleteMany()
  await prisma.packagingItemPurchase.deleteMany()
  await prisma.packagingItem.deleteMany({ where: { name: 'ENVELOPE TESTE' } })
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
}

beforeAll(async () => { await prisma.$connect() })
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => { await prisma.$disconnect() })

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

async function setup() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'A', material: 'PLA', colorName: 'Preto', colorHex: '#111111', currentStockGrams: 5000, avgUnitCostPerGram: 0.08 } })
  const envelope = await prisma.packagingItem.create({ data: { name: 'ENVELOPE TESTE', currentStock: 100, avgUnitCost: 0.8 } })
  const product = await prisma.product.create({
    data: {
      name: 'CHAVEIRO', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 0.5, laborTimeHours: 0,
      packagingUsages: { create: [{ packagingItemId: envelope.id, quantity: 1 }] },
    },
  })
  return { printer, filament, envelope, product }
}

const packagingStock = async (id: string) => (await prisma.packagingItem.findUniqueOrThrow({ where: { id } })).currentStock.toNumber()

describe('updateSaleQuantityPrice', () => {
  it('recalcula embalagem e lucro pela diferença, devolve os valores anteriores e valida entrada', async () => {
    const { envelope, product } = await setup()
    expect((await createSale(fd({ channel: 'DIRETA', productId: product.id, quantity: '2', unitPrice: '30', saleDate: '2026-10-01' }))).success).toBe(true)
    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(await packagingStock(envelope.id)).toBe(98)
    const before = await getSaleProfit(sale.id)

    const result = await updateSaleQuantityPrice(sale.id, 3, 40)
    expect(result.success).toBe(true)
    expect(result.previous).toEqual({ quantity: 2, unitPrice: 30 })
    expect(await packagingStock(envelope.id)).toBe(97)
    const after = await getSaleProfit(sale.id)
    expect(after.saleTotal).toBe(120)
    expect(after.profit).toBeGreaterThan(before.profit)

    // Desfazer = aplicar os valores anteriores.
    expect((await updateSaleQuantityPrice(sale.id, result.previous!.quantity, result.previous!.unitPrice)).success).toBe(true)
    expect(await packagingStock(envelope.id)).toBe(98)
    expect((await getSaleProfit(sale.id)).saleTotal).toBe(60)

    expect((await updateSaleQuantityPrice(sale.id, 0, 30)).success).toBe(false)
    expect((await updateSaleQuantityPrice(sale.id, 2, 0)).success).toBe(false)
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).quantity).toBe(2)
  })
})

describe('deliverOrderItem', () => {
  it('registra a venda do pedido pronto, devolve o lucro, e desfazer restaura tudo', async () => {
    const { printer, filament, envelope, product } = await setup()
    await createOrder(fd({
      channel: 'DIRETA', orderDate: '2026-10-01', deliveryDate: '2026-10-05',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 35 }]),
    }))
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    // Ainda sem estoque pronto: recusa.
    expect((await deliverOrderItem(item.id)).success).toBe(false)

    expect((await createProductionRun(fd({
      productId: product.id, printerId: printer.id, filamentId: filament.id, date: '2026-10-02',
      quantityPlanned: '1', quantitySuccess: '1', quantityFailed: '0', gramsUsed: '10', gramsWasted: '0', timeWastedHours: '0',
    }))).success).toBe(true)
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('PRONTO_RESERVADO')

    const delivered = await deliverOrderItem(item.id)
    expect(delivered.success).toBe(true)
    expect(delivered.saleTotal).toBe(35)
    expect(delivered.profit).toBeDefined()
    expect(await prisma.sale.count({ where: { productId: product.id } })).toBe(1)
    expect(await packagingStock(envelope.id)).toBe(99)

    expect((await undoOrderItemDelivery(item.id)).success).toBe(true)
    expect(await prisma.sale.count({ where: { productId: product.id } })).toBe(0)
    expect(await packagingStock(envelope.id)).toBe(100)
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('PRONTO_RESERVADO')
  })
})
