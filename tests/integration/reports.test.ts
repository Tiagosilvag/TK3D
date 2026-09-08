import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  getRevenueByChannel,
  getTopProducts,
  getConsignmentStockSummary,
  getConsignmentRevenue,
  getProductionSummary,
  getProductionByProduct,
  getFailuresByWasteReason,
  getPrinterUsage,
} from '@/lib/reports'
import { createProductionRun, cancelProductionRun } from '@/actions/productionRuns'
import type { ProductionCostSnapshot } from '@/lib/costing'

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

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
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
  const filament = await prisma.filament.create({ data: { manufacturer: 'F', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 100, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
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

// Fix 3 (task-10 brief): getTotalWasteCost() -- which used to live here and
// live-recalculated waste cost from CURRENT Printer/Filament/Settings for
// every historical run -- was removed along with its dashboard card. The
// "relatórios de produção (Task 9)" suite below already covers the correct,
// snapshot-based replacement (getProductionSummary().totalWasteCost, which
// sums each run's frozen costSnapshot.wasteCost and is now the only source
// of this number).

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

// Task 9 (spec §6, task-9 brief): dashboard production indicators + breakdown
// tables. Fixtures go through the REAL createProductionRun/cancelProductionRun
// actions (not hand-built rows) so costSnapshot has the exact shape Task 7
// produces -- these tests then read each run's own recorded costSnapshot.total
// back out of the DB and compare it against what the aggregation function
// summed, which is precisely what "sum costSnapshot, never recalculate" means
// to test (the cost FORMULA itself is already unit-tested in costing.test.ts).
describe('relatórios de produção (Task 9)', () => {
  async function createProductionFixtures() {
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })

    const printer1 = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const printer2 = await prisma.printer.create({ data: { name: 'P2', purchasePrice: 2000, depreciationHours: 8000, avgPowerConsumptionKwh: 0.2 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 100, spoolWeightKg: 1, initialStockGrams: 100000, currentStockGrams: 100000 } })
    const productA = await prisma.product.create({ data: { name: 'Produto A', printerId: printer1.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 } })
    const productB = await prisma.product.create({ data: { name: 'Produto B', printerId: printer2.id, filamentId: filament.id, weightGrams: 20, printTimeHours: 2, laborTimeHours: 0 } })

    const base = { filamentId: filament.id, gramsUsed: '50', gramsWasted: '5' }

    // Run 1: Produto A / P1, 2026-01-05, 10 planned / 10 success / 0 failed
    // => CONCLUIDA, no wasteReason.
    const r1 = await createProductionRun(fd({
      ...base, productId: productA.id, printerId: printer1.id,
      date: '2026-01-05', quantityPlanned: '10', quantitySuccess: '10', quantityFailed: '0', timeWastedHours: '0.1',
    }))
    expect(r1.success).toBe(true)

    // Run 2: Produto A / P1, 2026-01-10, 10 planned / 7 success / 3 failed,
    // wasteReason FALHA_IMPRESSAO => COM_FALHAS.
    const r2 = await createProductionRun(fd({
      ...base, productId: productA.id, printerId: printer1.id,
      date: '2026-01-10', quantityPlanned: '10', quantitySuccess: '7', quantityFailed: '3', timeWastedHours: '0.2',
      wasteReason: 'FALHA_IMPRESSAO',
    }))
    expect(r2.success).toBe(true)

    // Run 3: Produto B / P2, 2026-02-01, 10 planned / 8 success / 0 failed
    // => PARCIAL (success < planned, no failures).
    const r3 = await createProductionRun(fd({
      ...base, productId: productB.id, printerId: printer2.id,
      date: '2026-02-01', quantityPlanned: '10', quantitySuccess: '8', quantityFailed: '0', timeWastedHours: '0.3',
    }))
    expect(r3.success).toBe(true)

    // Run 4: Produto B / P2, 2026-02-15, 5 planned / 5 success / 0 failed,
    // then cancelled => CANCELADA.
    const r4 = await createProductionRun(fd({
      ...base, productId: productB.id, printerId: printer2.id,
      date: '2026-02-15', quantityPlanned: '5', quantitySuccess: '5', quantityFailed: '0', timeWastedHours: '0.4',
    }))
    expect(r4.success).toBe(true)

    const runs = await prisma.productionRun.findMany({ orderBy: { date: 'asc' } })
    const [run1, run2, run3, run4] = runs
    await cancelProductionRun(run4.id, 'Cancelado para teste')

    const snapshots = runs.map((r) => (r.costSnapshot as unknown as ProductionCostSnapshot).total)
    const wasteCosts = runs.map((r) => (r.costSnapshot as unknown as ProductionCostSnapshot).wasteCost)

    return {
      printer1, printer2, filament, productA, productB,
      run1, run2, run3, run4,
      snapshots: { run1: snapshots[0], run2: snapshots[1], run3: snapshots[2], run4: snapshots[3] },
      wasteCosts: { run1: wasteCosts[0], run2: wasteCosts[1], run3: wasteCosts[2], run4: wasteCosts[3] },
    }
  }

  describe('getProductionSummary', () => {
    // Fix 5 (task-10 brief): run4 is CANCELADA (cancelled in
    // createProductionFixtures above) -- a cancelled run had all its stock
    // fully reversed, so it represents zero real incurred cost. totalCost/
    // totalWasteCost must exclude it by default; totalRuns/
    // totalUnitsProduced/totalTimeHours are unaffected (that's not what Fix
    // 5 asks for -- only the cost/waste aggregates).
    it('agrega todas as produções sem filtro, excluindo custo/desperdício de produções CANCELADAs (Fix 5)', async () => {
      const f = await createProductionFixtures()
      const summary = await getProductionSummary()

      expect(summary.totalRuns).toBe(4)
      expect(summary.totalUnitsProduced).toBe(10 + 7 + 8 + 5) // 30
      expect(summary.successRate).toBeCloseTo((30 / 35) * 100, 5)
      // totalTimeHours = product.printTimeHours*quantitySuccess + timeWastedHours per run
      const expectedTime = (1 * 10 + 0.1) + (1 * 7 + 0.2) + (2 * 8 + 0.3) + (2 * 5 + 0.4)
      expect(summary.totalTimeHours).toBeCloseTo(expectedTime, 5)
      // run4 (CANCELADA) excluded from cost/waste totals.
      const expectedCost = f.snapshots.run1 + f.snapshots.run2 + f.snapshots.run3
      expect(summary.totalCost).toBeCloseTo(expectedCost, 5)
      const expectedWaste = f.wasteCosts.run1 + f.wasteCosts.run2 + f.wasteCosts.run3
      expect(summary.totalWasteCost).toBeCloseTo(expectedWaste, 5)
    })

    it('ao filtrar explicitamente por status=CANCELADA, o custo dessa produção volta a ser exibido (Fix 5)', async () => {
      const f = await createProductionFixtures()
      const summary = await getProductionSummary({ status: 'CANCELADA' })

      expect(summary.totalRuns).toBe(1)
      expect(summary.totalUnitsProduced).toBe(5)
      // The user explicitly asked to view the cancelled run -- its own
      // recorded cost snapshot is still shown for it, not silently zeroed.
      expect(summary.totalCost).toBeCloseTo(f.snapshots.run4, 5)
      expect(summary.totalWasteCost).toBeCloseTo(f.wasteCosts.run4, 5)
    })

    it('retorna zeros quando não há produções', async () => {
      const summary = await getProductionSummary()
      expect(summary).toEqual({
        totalRuns: 0,
        totalUnitsProduced: 0,
        successRate: 0,
        totalTimeHours: 0,
        totalCost: 0,
        totalWasteCost: 0,
      })
    })

    it('filtra por produto', async () => {
      const f = await createProductionFixtures()
      const summary = await getProductionSummary({ productId: f.productA.id })
      expect(summary.totalRuns).toBe(2)
      expect(summary.totalUnitsProduced).toBe(17)
      expect(summary.totalCost).toBeCloseTo(f.snapshots.run1 + f.snapshots.run2, 5)
    })

    it('filtra por impressora', async () => {
      const f = await createProductionFixtures()
      const summary = await getProductionSummary({ printerId: f.printer2.id })
      expect(summary.totalRuns).toBe(2)
      expect(summary.totalUnitsProduced).toBe(13)
    })

    it('filtra por status', async () => {
      await createProductionFixtures()
      const summary = await getProductionSummary({ status: 'CANCELADA' })
      expect(summary.totalRuns).toBe(1)
      expect(summary.totalUnitsProduced).toBe(5)

      const comFalhas = await getProductionSummary({ status: 'COM_FALHAS' })
      expect(comFalhas.totalRuns).toBe(1)
      expect(comFalhas.totalUnitsProduced).toBe(7)
    })

    it('filtra por motivo de desperdício', async () => {
      await createProductionFixtures()
      const summary = await getProductionSummary({ wasteReason: 'FALHA_IMPRESSAO' })
      expect(summary.totalRuns).toBe(1)
      expect(summary.totalUnitsProduced).toBe(7)
    })

    it('filtra por período (data inicial/final)', async () => {
      await createProductionFixtures()
      const summary = await getProductionSummary({ from: new Date('2026-02-01'), to: new Date('2026-02-28') })
      expect(summary.totalRuns).toBe(2)
      expect(summary.totalUnitsProduced).toBe(13)
    })
  })

  describe('getProductionByProduct', () => {
    it('agrupa produção por produto, excluindo custo de produções CANCELADAs (Fix 5)', async () => {
      const f = await createProductionFixtures()
      const rows = await getProductionByProduct()
      expect(rows).toHaveLength(2)

      const rowA = rows.find((r) => r.productId === f.productA.id)!
      expect(rowA.runsCount).toBe(2)
      expect(rowA.quantitySuccess).toBe(17)
      expect(rowA.totalCost).toBeCloseTo(f.snapshots.run1 + f.snapshots.run2, 5)

      // run4 (CANCELADA) still counts toward runsCount/quantitySuccess but
      // contributes zero to totalCost by default.
      const rowB = rows.find((r) => r.productId === f.productB.id)!
      expect(rowB.runsCount).toBe(2)
      expect(rowB.quantitySuccess).toBe(13)
      expect(rowB.totalCost).toBeCloseTo(f.snapshots.run3, 5)
    })

    it('respeita filtros', async () => {
      const f = await createProductionFixtures()
      const rows = await getProductionByProduct({ productId: f.productA.id })
      expect(rows).toHaveLength(1)
      expect(rows[0].productId).toBe(f.productA.id)
    })

    it('retorna lista vazia quando não há produções', async () => {
      const rows = await getProductionByProduct()
      expect(rows).toEqual([])
    })
  })

  describe('getFailuresByWasteReason', () => {
    it('agrupa falhas por motivo, ignorando produções sem motivo', async () => {
      await createProductionFixtures()
      const rows = await getFailuresByWasteReason()
      expect(rows).toEqual([
        { wasteReason: 'FALHA_IMPRESSAO', runsCount: 1, quantityFailed: 3 },
      ])
    })

    it('retorna lista vazia quando não há falhas classificadas', async () => {
      const rows = await getFailuresByWasteReason()
      expect(rows).toEqual([])
    })
  })

  describe('getPrinterUsage', () => {
    it('agrupa uso por impressora (contagem e horas)', async () => {
      const f = await createProductionFixtures()
      const rows = await getPrinterUsage()
      expect(rows).toHaveLength(2)

      const row1 = rows.find((r) => r.printerId === f.printer1.id)!
      expect(row1.runsCount).toBe(2)
      expect(row1.totalHours).toBeCloseTo((1 * 10 + 0.1) + (1 * 7 + 0.2), 5)

      const row2 = rows.find((r) => r.printerId === f.printer2.id)!
      expect(row2.runsCount).toBe(2)
      expect(row2.totalHours).toBeCloseTo((2 * 8 + 0.3) + (2 * 5 + 0.4), 5)
    })

    it('respeita filtros', async () => {
      const f = await createProductionFixtures()
      const rows = await getPrinterUsage({ printerId: f.printer1.id })
      expect(rows).toHaveLength(1)
      expect(rows[0].printerId).toBe(f.printer1.id)
    })

    it('retorna lista vazia quando não há produções', async () => {
      const rows = await getPrinterUsage()
      expect(rows).toEqual([])
    })
  })
})
