import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProductionRun } from '@/actions/productionRuns'
import { getAssemblyStatus } from '@/actions/assembly'
import { getOwnStockSummary } from '@/lib/reports'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.stockConsumption.deleteMany()
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.productPartFilament.deleteMany()
  await prisma.productPart.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.accessory.deleteMany()
  await prisma.accessoryTypeRecord.deleteMany()
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

async function setup() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const preto = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PETG', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const verde = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PETG', colorName: 'Verde', colorHex: '#00ff00', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  return { printer, preto, verde }
}

// Melhoria "Peça multi-filamento sem montagem": produto composto com UMA
// ÚNICA peça (quantityPerUnit=1), multi-filamento, sem insumo/acessório/
// componente -- a peça já sai pronta da impressora (ex.: cubo metade
// preto/metade verde impresso numa tacada só), nunca precisa de um clique
// manual em /assembly pra virar estoque vendável.
describe('auto-montagem de produto composto de 1 peça só', () => {
  it('createProductionRun já conta como estoque, sem precisar de confirmAssembly', async () => {
    const { printer, preto, verde } = await setup()
    const product = await prisma.product.create({
      data: { name: 'CUBO MÁGICO', category: 'Decoração', isComposite: true, printerId: printer.id, filamentId: preto.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0 },
    })
    const corpo = await prisma.productPart.create({
      data: {
        productId: product.id,
        name: 'CORPO',
        printerId: printer.id,
        printTimeHours: 1,
        quantityPerUnit: 1,
        filamentComponents: { create: [{ filamentId: preto.id, weightGrams: 10 }, { filamentId: verde.id, weightGrams: 10 }] },
      },
    })

    const result = await createProductionRun(fd({
      productId: product.id,
      productPartId: corpo.id,
      printerId: printer.id,
      filamentId: preto.id,
      date: '2026-10-03',
      quantityPlanned: '3',
      quantitySuccess: '3',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
      filamentUsagesJson: JSON.stringify([
        { filamentId: preto.id, gramsUsed: 30, gramsWasted: 0 },
        { filamentId: verde.id, gramsUsed: 30, gramsWasted: 0 },
      ]),
    }))
    expect(result.success).toBe(true)

    // Já tem ProductAssembly automática, sem nenhuma chamada a confirmAssembly.
    const assemblies = await prisma.productAssembly.findMany({ where: { productId: product.id } })
    expect(assemblies).toHaveLength(1)
    expect(assemblies[0].quantity).toBe(3)
    expect(assemblies[0].colorChoices).toEqual({ [corpo.id]: [preto.id, verde.id].sort().join(',') })

    const summary = await getOwnStockSummary()
    const row = summary.find((r) => r.productId === product.id)
    expect(row?.available).toBe(3)

    const status = await getAssemblyStatus(product.id)
    expect(status.maxAssemblableUnits).toBe(0)
  })

  it('produto com 2 peças continua exigindo montagem manual', async () => {
    const { printer, preto, verde } = await setup()
    const product = await prisma.product.create({
      data: { name: 'BONECO', category: 'Decoração', isComposite: true, printerId: printer.id, filamentId: preto.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0 },
    })
    const cabeca = await prisma.productPart.create({
      data: { productId: product.id, name: 'CABEÇA', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: preto.id, weightGrams: 10 }] } },
    })
    await prisma.productPart.create({
      data: { productId: product.id, name: 'CORPO', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: verde.id, weightGrams: 10 }] } },
    })

    await createProductionRun(fd({
      productId: product.id,
      productPartId: cabeca.id,
      printerId: printer.id,
      filamentId: preto.id,
      date: '2026-10-03',
      quantityPlanned: '3',
      quantitySuccess: '3',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))

    const assemblies = await prisma.productAssembly.findMany({ where: { productId: product.id } })
    expect(assemblies).toHaveLength(0)

    const summary = await getOwnStockSummary()
    const row = summary.find((r) => r.productId === product.id)
    expect(row?.available ?? 0).toBe(0)
  })

  it('produto de 1 peça só mas com acessório cadastrado continua exigindo montagem manual', async () => {
    const { printer, preto } = await setup()
    const accessoryType = await prisma.accessoryTypeRecord.create({ data: { name: 'Mosquetão' } })
    const accessory = await prisma.accessory.create({
      data: { name: 'Mosquetão P', type: accessoryType.id, currentStock: 100, avgUnitCost: 0.5 },
    })
    const product = await prisma.product.create({
      data: { name: 'CHAVEIRO', category: 'Chaveiro', isComposite: true, printerId: printer.id, filamentId: preto.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0 },
    })
    const corpo = await prisma.productPart.create({
      data: { productId: product.id, name: 'CORPO', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: preto.id, weightGrams: 10 }] } },
    })
    await prisma.productAccessoryUsage.create({ data: { productId: product.id, accessoryId: accessory.id, quantity: 1 } })

    await createProductionRun(fd({
      productId: product.id,
      productPartId: corpo.id,
      printerId: printer.id,
      filamentId: preto.id,
      date: '2026-10-03',
      quantityPlanned: '3',
      quantitySuccess: '3',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))

    const assemblies = await prisma.productAssembly.findMany({ where: { productId: product.id } })
    expect(assemblies).toHaveLength(0)
  })
})
