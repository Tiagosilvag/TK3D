import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProductionRunDemandBatch } from '@/actions/productionRuns'
import { createOrder } from '@/actions/orders'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
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

async function createSimpleProduct(name: string) {
  const printer = await prisma.printer.create({ data: { name: `${name} printer`, purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: name, colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 0.08 } })
  const product = await prisma.product.create({
    data: { name, category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 },
  })
  return { printer, filament, product }
}

function demandItem(opts: { productId: string; printerId: string; filamentId: string; quantity: number }) {
  return {
    productId: opts.productId,
    productPartId: null,
    printerId: opts.printerId,
    date: '2026-10-01',
    quantityPlanned: opts.quantity,
    quantitySuccess: opts.quantity,
    filaments: [{ filamentId: opts.filamentId, weightGramsPerUnit: 10, gramsWasted: 0 }],
    timeWastedHours: 0,
    wasteReason: null,
    notes: null,
  }
}

describe('createProductionRunDemandBatch', () => {
  it('registra produção de 2 produtos DIFERENTES numa submissão só e reconcilia os pedidos de cada um', async () => {
    const a = await createSimpleProduct('Produto A')
    const b = await createSimpleProduct('Produto B')

    const orderA = await createOrder(fd({
      channel: 'DIRETA',
      orderDate: '2026-09-01',
      deliveryDate: '2026-09-20',
      itemsJson: JSON.stringify([{ productId: a.product.id, colorComboKey: a.filament.id, quantity: 3, unitPrice: 20 }]),
    }))
    expect(orderA.success).toBe(true)
    const orderB = await createOrder(fd({
      channel: 'DIRETA',
      orderDate: '2026-09-01',
      deliveryDate: '2026-09-20',
      itemsJson: JSON.stringify([{ productId: b.product.id, colorComboKey: b.filament.id, quantity: 2, unitPrice: 15 }]),
    }))
    expect(orderB.success).toBe(true)

    const itemA = await prisma.orderItem.findFirstOrThrow({ where: { productId: a.product.id } })
    const itemB = await prisma.orderItem.findFirstOrThrow({ where: { productId: b.product.id } })
    expect(itemA.status).toBe('AGUARDANDO_PRODUCAO')
    expect(itemB.status).toBe('AGUARDANDO_PRODUCAO')

    const result = await createProductionRunDemandBatch(fd({
      itemsJson: JSON.stringify([
        demandItem({ productId: a.product.id, printerId: a.printer.id, filamentId: a.filament.id, quantity: 3 }),
        demandItem({ productId: b.product.id, printerId: b.printer.id, filamentId: b.filament.id, quantity: 2 }),
      ]),
    }))
    expect(result.success).toBe(true)

    const runsA = await prisma.productionRun.findMany({ where: { productId: a.product.id } })
    const runsB = await prisma.productionRun.findMany({ where: { productId: b.product.id } })
    expect(runsA).toHaveLength(1)
    expect(runsB).toHaveLength(1)
    expect(runsA[0].quantitySuccess).toBe(3)
    expect(runsB[0].quantitySuccess).toBe(2)

    const filamentA = await prisma.filament.findUniqueOrThrow({ where: { id: a.filament.id } })
    const filamentB = await prisma.filament.findUniqueOrThrow({ where: { id: b.filament.id } })
    expect(filamentA.currentStockGrams.toNumber()).toBe(1000 - 30)
    expect(filamentB.currentStockGrams.toNumber()).toBe(1000 - 20)

    const refreshedA = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemA.id } })
    const refreshedB = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemB.id } })
    expect(refreshedA.status).toBe('PRONTO_RESERVADO')
    expect(refreshedA.reservedQuantity).toBe(3)
    expect(refreshedB.status).toBe('PRONTO_RESERVADO')
    expect(refreshedB.reservedQuantity).toBe(2)
  })

  it('tudo ou nada: se um item do lote não tem estoque suficiente, NENHUMA produção do lote é gravada', async () => {
    const a = await createSimpleProduct('Produto A')
    const b = await createSimpleProduct('Produto B')

    const result = await createProductionRunDemandBatch(fd({
      itemsJson: JSON.stringify([
        demandItem({ productId: a.product.id, printerId: a.printer.id, filamentId: a.filament.id, quantity: 3 }),
        // Pede mais filamento do que existe em estoque pro produto B.
        { ...demandItem({ productId: b.product.id, printerId: b.printer.id, filamentId: b.filament.id, quantity: 2 }), filaments: [{ filamentId: b.filament.id, weightGramsPerUnit: 10000, gramsWasted: 0 }] },
      ]),
    }))
    expect(result.success).toBe(false)

    const runsA = await prisma.productionRun.findMany({ where: { productId: a.product.id } })
    const runsB = await prisma.productionRun.findMany({ where: { productId: b.product.id } })
    expect(runsA).toHaveLength(0)
    expect(runsB).toHaveLength(0)
    const filamentA = await prisma.filament.findUniqueOrThrow({ where: { id: a.filament.id } })
    expect(filamentA.currentStockGrams.toNumber()).toBe(1000)
  })
})
