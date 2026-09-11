import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createSale, getSaleProfit } from '@/actions/sales'
import { getProductCostBreakdown } from '@/actions/products'
import { getProductVariantStockOptions } from '@/lib/reports'
import { createConsignmentDeliveryBatch } from '@/actions/consignmentDeliveries'
import type { SaleCostSnapshot } from '@/lib/costing'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  // Sale references Product, which references Printer/Filament, so it must
  // be wiped before those parent tables (children before parents), matching
  // the discipline in productionRuns.test.ts. productAccessoryUsage/
  // accessory/supply added for the Sale cost snapshot tests below, which
  // give a product an accessory usage to mutate its price after a sale.
  await prisma.sale.deleteMany()
  await prisma.consignmentSaleReport.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productSupplyUsage.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.accessory.deleteMany()
  await prisma.supply.deleteMany()
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

// New feature (task-10 brief): Sale gains costSnapshot, mirroring
// ProductionRun's exactly (spec §4 pattern, Task 7). createSale computes and
// stores it ONCE at creation time from getProductCostBreakdown's
// then-current values; getSaleProfit() reads it back instead of
// recalculating live. Same guarantee already proven for ProductionRun in
// Task 7's tests: changing a price afterward must not move an
// already-recorded sale's profit.
describe('Sale cost snapshot (task-10 brief, new feature)', () => {
  async function createProductWithAccessory() {
    const printer = await prisma.printer.create({ data: { name: 'P2', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F2', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const accessory = await prisma.accessory.create({ data: { name: 'Argola Snapshot', type: 'MOSQUETAO', currentStock: 100, avgUnitCost: 0.50 } })
    const product = await prisma.product.create({
      data: {
        name: 'Produto Com Acessório Snapshot',
        printerId: printer.id,
        filamentId: filament.id,
        weightGrams: 30,
        printTimeHours: 2,
        laborTimeHours: 0.25,
      },
    })
    await prisma.productAccessoryUsage.create({ data: { productId: product.id, accessoryId: accessory.id, quantity: 2 } })
    return { printer, filament, accessory, product }
  }

  it('createSale grava um costSnapshot com o total correto (unitCost.finalCost * quantity)', async () => {
    const { product } = await createProductWithAccessory()

    const result = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '3',
      unitPrice: '50.00',
      saleDate: '2026-09-01',
    }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(sale.costSnapshot).not.toBeNull()
    const snapshot = sale.costSnapshot as unknown as SaleCostSnapshot
    expect(snapshot.quantity).toBe(3)
    expect(snapshot.total).toBeCloseTo(snapshot.unitCost.finalCost * 3, 6)

    const profit = await getSaleProfit(sale.id)
    expect(profit.estimated).toBe(false)
    expect(profit.profit).toBeCloseTo(3 * 50 - snapshot.total, 6)
  })

  it('lucro de uma venda já registrada NÃO muda depois que o preço de um acessório ou de Settings muda (mesma garantia de ProductionRun/Task 7)', async () => {
    const { accessory, printer, product } = await createProductWithAccessory()
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })

    const result = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '2',
      unitPrice: '60.00',
      saleDate: '2026-09-01',
    }))
    expect(result.success).toBe(true)
    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })

    const profitBefore = await getSaleProfit(sale.id)
    expect(profitBefore.estimated).toBe(false)

    // Change the accessory's avgUnitCost (e.g. a new, more expensive
    // AccessoryPurchase recalculated it), a Settings cost input, AND the
    // product's printer's own tariff/maintenance (melhoria "Impressoras":
    // these two moved from Settings to Printer) -- all AFTER the sale was
    // already recorded.
    await prisma.accessory.update({ where: { id: accessory.id }, data: { avgUnitCost: 99 } })
    await prisma.settings.update({ where: { id: 1 }, data: { laborCostPerHour: 999 } })
    await prisma.printer.update({ where: { id: printer.id }, data: { energyCostPerKwh: 999, maintenanceCostPerHour: 999 } })

    const profitAfter = await getSaleProfit(sale.id)
    expect(profitAfter.profit).toBeCloseTo(profitBefore.profit, 6)
    expect(profitAfter.estimated).toBe(false)

    // Sanity check: had this sale recalculated live (the old, pre-Fix
    // behavior), its profit WOULD have moved -- proving the settings/
    // accessory change above was actually capable of affecting cost.
    const liveBreakdown = await getProductCostBreakdown(product.id)
    const liveRecomputedProfit = 2 * (60 - liveBreakdown.finalCost)
    expect(liveRecomputedProfit).not.toBeCloseTo(profitBefore.profit, 1)
  })

  it('venda legada sem costSnapshot (pré-migration) cai no fallback de recálculo ao vivo, marcado como estimated', async () => {
    const { product } = await createProductWithAccessory()

    // Simulates a pre-migration row: created directly, bypassing createSale,
    // so costSnapshot stays null (exactly what old rows look like).
    const legacySale = await prisma.sale.create({
      data: { channel: 'DIRETA', productId: product.id, quantity: 1, unitPrice: 100, saleDate: new Date('2026-01-01') },
    })
    expect(legacySale.costSnapshot).toBeNull()

    const profit = await getSaleProfit(legacySale.id)
    expect(profit.estimated).toBe(true)
    // Doesn't crash/lock the screen -- a real number comes back, computed
    // live via getProductCostBreakdown, matching the pre-Fix behavior for
    // exactly this legacy case.
    expect(typeof profit.profit).toBe('number')
    expect(Number.isFinite(profit.profit)).toBe(true)
  })
})

// Melhoria "Vendas por variante": Sale ganha colorComboKey (mesma convenção
// de ConsignmentDelivery.colorComboKey) -- createSale/updateSale gravam
// exatamente o que o formulário manda, sem checagem de estoque bloqueante
// no servidor (mesmo padrão de createConsignmentDeliveryBatch).
describe('Vendas por variante (Sale.colorComboKey)', () => {
  async function createTwoColorProduct() {
    const printer = await prisma.printer.create({ data: { name: 'P3', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const rosa = await prisma.filament.create({ data: { manufacturer: 'F3', material: 'PLA', colorName: 'Rosa', colorHex: '#ff69b4', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const azul = await prisma.filament.create({ data: { manufacturer: 'F3', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', rollNumber: 2, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const product = await prisma.product.create({
      data: { name: 'Produto Duas Cores', category: 'Chaveiro', printerId: printer.id, filamentId: rosa.id, weightGrams: 10, printTimeHours: 0.3, laborTimeHours: 0 },
    })
    // Produzido direto via ProductionRun (produto sem componente algum --
    // "produzido" já É o estoque, sem passar por Montagem).
    await prisma.productionRun.create({
      data: { batchId: 'b1', productId: product.id, printerId: printer.id, filamentId: rosa.id, date: new Date('2026-09-01'), quantityPlanned: 45, quantitySuccess: 45, quantityFailed: 0, gramsUsed: 450, gramsWasted: 0, timeWastedHours: 0 },
    })
    await prisma.productionRun.create({
      data: { batchId: 'b2', productId: product.id, printerId: printer.id, filamentId: azul.id, date: new Date('2026-09-01'), quantityPlanned: 30, quantitySuccess: 30, quantityFailed: 0, gramsUsed: 300, gramsWasted: 0, timeWastedHours: 0 },
    })
    return { printer, rosa, azul, product }
  }

  it('createSale grava a cor escolhida (colorComboKey), e null quando o formulário não manda nenhuma', async () => {
    const { product, rosa } = await createTwoColorProduct()

    const result = await createSale(fd({
      channel: 'DIRETA', productId: product.id, quantity: '2', unitPrice: '30.00', saleDate: '2026-09-05', colorComboKey: rosa.id,
    }))
    expect(result.success).toBe(true)
    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(sale.colorComboKey).toBe(rosa.id)

    await prisma.sale.deleteMany({ where: { productId: product.id } })
    const withoutColor = await createSale(fd({ channel: 'DIRETA', productId: product.id, quantity: '1', unitPrice: '30.00', saleDate: '2026-09-05' }))
    expect(withoutColor.success).toBe(true)
    const saleNoColor = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(saleNoColor.colorComboKey).toBeNull()
  })

  it('getProductVariantStockOptions desconta TANTO venda direta QUANTO entrega em consignação do mesmo pool por cor', async () => {
    const { product, rosa, azul } = await createTwoColorProduct()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Ana', defaultCommissionPercent: 0.3 } })

    // Vende 10 Rosa direto e entrega 15 Rosa em consignação -- ambos
    // consomem do MESMO pool de 45 Rosa produzidos.
    await createSale(fd({ channel: 'DIRETA', productId: product.id, quantity: '10', unitPrice: '30.00', saleDate: '2026-09-05', colorComboKey: rosa.id }))
    await createConsignmentDeliveryBatch(fd({
      partnerId: partner.id, deliveryDate: '2026-09-06', notes: '',
      itemsJson: JSON.stringify([{ productId: product.id, colorComboKey: rosa.id, quantityDelivered: 15, unitPrice: 25 }]),
    }))

    const options = await getProductVariantStockOptions()
    const option = options.find((o) => o.productId === product.id)!
    const rosaOption = option.variants.find((v) => v.key === rosa.id)!
    expect(rosaOption.available).toBe(45 - 10 - 15) // 20

    // Azul não foi tocado -- continua com os 30 inteiros.
    const azulOption = option.variants.find((v) => v.key === azul.id)!
    expect(azulOption.available).toBe(30)
  })
})
