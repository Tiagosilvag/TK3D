import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { createOrder, updateOrderItemStatus, getOrderDemandQueue } from '@/actions/orders'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.consignmentSaleReport.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.stockConsumption.deleteMany()
  await prisma.productPackagingUsage.deleteMany()
  await prisma.packagingItem.deleteMany()
  await prisma.productionRun.deleteMany()
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
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 0.08 } })
  const product = await prisma.product.create({
    data: { name: 'Peça consignada', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 30, printTimeHours: 2, laborTimeHours: 0.25 },
  })
  const partner = await prisma.consignmentPartner.create({ data: { name: 'Parceiro Teste', defaultCommissionPercent: 0.3 } })
  return { printer, filament, product, partner }
}

function orderFd(opts: { productId: string; quantity: string; consignmentPartnerId: string; unitPrice?: string }): FormData {
  return fd({
    channel: 'CONSIGNADO',
    orderDate: '2026-09-01',
    deliveryDate: '2026-09-20',
    consignmentPartnerId: opts.consignmentPartnerId,
    itemsJson: JSON.stringify([{ productId: opts.productId, colorComboKey: null, quantity: Number(opts.quantity), unitPrice: Number(opts.unitPrice ?? '30') }]),
  })
}

describe('createOrder canal CONSIGNADO', () => {
  it('exige consignmentPartnerId -- falha sem ele', async () => {
    const { product } = await createSupportRecords()
    const result = await createOrder(fd({
      channel: 'CONSIGNADO',
      orderDate: '2026-09-01',
      deliveryDate: '2026-09-20',
      itemsJson: JSON.stringify([{ productId: product.id, colorComboKey: null, quantity: 2, unitPrice: 30 }]),
    }))
    expect(result.success).toBe(false)
  })

  it('com parceiro válido e estoque disponível, nasce Pronto -- reservado', async () => {
    const { product, printer, filament, partner } = await createSupportRecords()
    await prisma.productionRun.create({
      data: {
        productId: product.id,
        printerId: printer.id,
        filamentId: filament.id,
        date: new Date('2026-09-01'),
        quantityPlanned: 3,
        quantitySuccess: 3,
        quantityFailed: 0,
        gramsUsed: 90,
        gramsWasted: 0,
        timeWastedHours: 0,
        status: 'CONCLUIDA',
        batchId: randomUUID(),
      },
    })
    const result = await createOrder(orderFd({ productId: product.id, quantity: '3', consignmentPartnerId: partner.id }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('PRONTO_RESERVADO')
    expect(item.reservedQuantity).toBe(3)

    const order = await prisma.order.findUniqueOrThrow({ where: { id: item.orderId } })
    expect(order.consignmentPartnerId).toBe(partner.id)
  })
})

describe('updateOrderItemStatus ENTREGUE -- canal CONSIGNADO', () => {
  it('cria 1 ConsignmentDelivery (nunca Sale), vincula consignmentDeliveryId e NÃO consome embalagem', async () => {
    const { product, printer, filament, partner } = await createSupportRecords()
    const packaging = await prisma.packagingItem.create({ data: { name: 'Saquinho teste', currentStock: 100, avgUnitCost: 0.5 } })
    await prisma.productPackagingUsage.create({ data: { productId: product.id, packagingItemId: packaging.id, quantity: 1 } })
    await prisma.productionRun.create({
      data: {
        productId: product.id,
        printerId: printer.id,
        filamentId: filament.id,
        date: new Date('2026-09-01'),
        quantityPlanned: 3,
        quantitySuccess: 3,
        quantityFailed: 0,
        gramsUsed: 90,
        gramsWasted: 0,
        timeWastedHours: 0,
        status: 'CONCLUIDA',
        batchId: randomUUID(),
      },
    })
    await createOrder(orderFd({ productId: product.id, quantity: '3', consignmentPartnerId: partner.id, unitPrice: '25' }))
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    const result = await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))
    expect(result.success).toBe(true)

    const refreshed = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(refreshed.status).toBe('ENTREGUE')
    expect(refreshed.saleId).toBeNull()
    expect(refreshed.consignmentDeliveryId).not.toBeNull()

    const deliveries = await prisma.consignmentDelivery.findMany({ where: { productId: product.id } })
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].partnerId).toBe(partner.id)
    expect(deliveries[0].quantityDelivered).toBe(3)
    expect(deliveries[0].unitPrice.toNumber()).toBe(25)

    const sales = await prisma.sale.findMany({ where: { productId: product.id } })
    expect(sales).toHaveLength(0)

    const refreshedPackaging = await prisma.packagingItem.findUniqueOrThrow({ where: { id: packaging.id } })
    expect(refreshedPackaging.currentStock.toNumber()).toBe(100)
  })

  it('idempotente: chamar ENTREGUE de novo não cria uma 2ª ConsignmentDelivery', async () => {
    const { product, printer, filament, partner } = await createSupportRecords()
    await prisma.productionRun.create({
      data: {
        productId: product.id,
        printerId: printer.id,
        filamentId: filament.id,
        date: new Date('2026-09-01'),
        quantityPlanned: 2,
        quantitySuccess: 2,
        quantityFailed: 0,
        gramsUsed: 60,
        gramsWasted: 0,
        timeWastedHours: 0,
        status: 'CONCLUIDA',
        batchId: randomUUID(),
      },
    })
    await createOrder(orderFd({ productId: product.id, quantity: '2', consignmentPartnerId: partner.id }))
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))
    const second = await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))
    expect(second.success).toBe(true)

    const deliveries = await prisma.consignmentDelivery.findMany({ where: { productId: product.id } })
    expect(deliveries).toHaveLength(1)
  })
})

describe('getOrderDemandQueue -- canal CONSIGNADO', () => {
  it('pedido Consignado sem estoque aparece na fila de demanda igual um pedido Direta', async () => {
    const { product, partner } = await createSupportRecords()
    const result = await createOrder(orderFd({ productId: product.id, quantity: '5', consignmentPartnerId: partner.id }))
    expect(result.success).toBe(true)

    const queue = await getOrderDemandQueue()
    const row = queue.productionRows.find((r) => r.productId === product.id)
    expect(row).toBeDefined()
    expect(row!.neededUnits).toBe(5)
    expect(row!.channel).toBe('CONSIGNADO')
  })
})
