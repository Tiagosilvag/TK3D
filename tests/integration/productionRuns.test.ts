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
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', diameterMm: 1.75, spoolPrice: 80, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 } })
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
      gramsWasted: '0',
      timeWastedHours: '0',
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    const del = await deleteProductionRun(run.id)
    expect(del.success).toBe(true)

    const gone = await prisma.productionRun.findUnique({ where: { id: run.id } })
    expect(gone).toBeNull()
  })
})
