import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProductionRun, deleteProductionRun } from '@/actions/productionRuns'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  // ProductionRun references Product/Printer/Filament, so it must be wiped
  // before those parent tables (children before parents), matching the
  // discipline in products.test.ts.
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

describe('productionRuns actions', () => {
  it('cria um registro de produção válido', async () => {
    const { printer, filament, product } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '10',
      quantitySuccess: '8',
      quantityFailed: '2',
      gramsUsed: '240',
      gramsWasted: '15',
      timeWastedHours: '0.5',
    }))
    expect(result.success).toBe(true)

    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    expect(run.quantityPlanned).toBe(10)
    expect(run.quantitySuccess).toBe(8)
    expect(run.quantityFailed).toBe(2)
  })

  it('rejeita quando sucesso + falhas excede o planejado', async () => {
    const { printer, filament, product } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '10',
      quantitySuccess: '8',
      quantityFailed: '5',
      gramsUsed: '240',
      gramsWasted: '15',
      timeWastedHours: '0.5',
    }))
    expect(result.success).toBe(false)

    const run = await prisma.productionRun.findFirst({ where: { productId: product.id } })
    expect(run).toBeNull()
  })

  it('remove fisicamente um registro de produção (log histórico)', async () => {
    const { printer, filament, product } = await createSupportRecords()

    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '10',
      quantitySuccess: '10',
      quantityFailed: '0',
      gramsUsed: '0',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    const del = await deleteProductionRun(run.id)
    expect(del.success).toBe(true)

    const gone = await prisma.productionRun.findUnique({ where: { id: run.id } })
    expect(gone).toBeNull()
  })

  it('deduz gramsUsed + gramsWasted do estoque do filamento ao criar um registro válido', async () => {
    const { printer, filament, product } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '10',
      quantitySuccess: '8',
      quantityFailed: '2',
      gramsUsed: '240',
      gramsWasted: '15',
      timeWastedHours: '0.5',
    }))
    expect(result.success).toBe(true)

    const updatedFilament = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })
    expect(updatedFilament.currentStockGrams.toNumber()).toBe(1000 - (240 + 15))
  })

  it('rejeita e não altera nada (nem o registro nem o estoque) quando gramsUsed + gramsWasted excede o estoque disponível', async () => {
    const { printer, filament, product } = await createSupportRecords()
    // filament.currentStockGrams is 1000g; request more than that.

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '10',
      quantitySuccess: '8',
      quantityFailed: '2',
      gramsUsed: '900',
      gramsWasted: '200',
      timeWastedHours: '0.5',
    }))
    expect(result.success).toBe(false)
    expect(result.error).toBe('Quantidade excede o estoque disponível (1000g)')

    const run = await prisma.productionRun.findFirst({ where: { productId: product.id } })
    expect(run).toBeNull()

    const unchangedFilament = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })
    expect(unchangedFilament.currentStockGrams.toNumber()).toBe(1000)
  })

  it('restaura o estoque do filamento ao remover um registro de produção (corrige um lançamento errado)', async () => {
    const { printer, filament, product } = await createSupportRecords()
    // filament.currentStockGrams starts at 1000g.

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '10',
      quantitySuccess: '8',
      quantityFailed: '2',
      gramsUsed: '240',
      gramsWasted: '15',
      timeWastedHours: '0.5',
    }))
    expect(result.success).toBe(true)

    const afterCreate = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })
    expect(afterCreate.currentStockGrams.toNumber()).toBe(1000 - (240 + 15))

    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    const del = await deleteProductionRun(run.id)
    expect(del.success).toBe(true)

    const gone = await prisma.productionRun.findUnique({ where: { id: run.id } })
    expect(gone).toBeNull()

    const afterDelete = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })
    expect(afterDelete.currentStockGrams.toNumber()).toBe(1000)
  })
})
