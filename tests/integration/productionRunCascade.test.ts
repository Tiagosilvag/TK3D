import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProductionRun, deleteProductionRun, cancelProductionRun } from '@/actions/productionRuns'
import { confirmAssembly, getAssemblyStatus } from '@/actions/assembly'
import { getOwnStockSummary } from '@/lib/reports'
import { createSale } from '@/actions/sales'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.sale.deleteMany()
  await prisma.stockConsumption.deleteMany()
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  // componentProductId é onDelete: Restrict -- precisa sumir antes de
  // apagar o Product que serve de componente (ex.: Mosquetão).
  await prisma.productComponentUsage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.accessory.deleteMany()
  await prisma.supply.deleteMany()
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

// Produto simples que precisa de montagem (insumo cadastrado) -- mesmo
// cenário do bug relatado: "produção que já estava em estoque".
async function createSupportRecords() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 10000, currentStockGrams: 10000 } })
  const accessory = await prisma.accessory.create({ data: { name: 'Argola Dourada', type: 'OUTRO', colorName: '', currentStock: 100, avgUnitCost: 0.5 } })
  const supply = await prisma.supply.create({ data: { name: 'Cola Quente', unit: 'ML', currentStock: 50, avgUnitCost: 1.2 } })
  const product = await prisma.product.create({
    data: {
      name: 'Chaveirinho',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: 10,
      printTimeHours: 0.5,
      laborTimeHours: 0,
      accessoryUsages: { create: [{ accessoryId: accessory.id, quantity: 1 }] },
      supplyUsages: { create: [{ supplyId: supply.id, quantity: 1 }] },
    },
  })
  return { printer, filament, accessory, supply, product }
}

async function produce(product: { id: string }, printer: { id: string }, filament: { id: string }, quantity: number) {
  const result = await createProductionRun(fd({
    productId: product.id,
    printerId: printer.id,
    filamentId: filament.id,
    date: '2026-09-11',
    quantityPlanned: String(quantity),
    quantitySuccess: String(quantity),
    quantityFailed: '0',
    gramsUsed: String(10 * quantity),
    gramsWasted: '0',
    timeWastedHours: '0',
  }))
  expect(result.success).toBe(true)
  const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id }, orderBy: { createdAt: 'desc' } })
  return run
}

async function assemble(product: { id: string }, filament: { id: string }, accessory: { id: string }, supply: { id: string }, quantity: number) {
  const result = await confirmAssembly(fd({
    productId: product.id,
    quantity: String(quantity),
    accessoryUsagesJson: JSON.stringify([{ id: accessory.id, quantityPerUnit: 1 }]),
    supplyUsagesJson: JSON.stringify([{ id: supply.id, quantityPerUnit: 1 }]),
    colorChoicesJson: JSON.stringify({ [product.id]: filament.id }),
  }))
  expect(result.success).toBe(true)
}

// Componente compartilhado (ex. real: Mosquetão) -- produto simples SEM
// montagem própria (sem accessory/supply), consumido como componente por
// DOIS produtos pai DIFERENTES (A e B), cada um simples-com-montagem só
// por causa do componentUsage (mesma regra de productNeedsAssembly).
async function createSharedComponentScenario() {
  const printer = await prisma.printer.create({ data: { name: 'P2', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F2', material: 'PLA', colorName: 'Vermelho', colorHex: '#FF0000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 10000, currentStockGrams: 10000 } })

  const mosquetao = await prisma.product.create({
    data: { name: 'Mosquetão', category: 'Acessório', printerId: printer.id, filamentId: filament.id, weightGrams: 3, printTimeHours: 0.2, laborTimeHours: 0 },
  })
  const productA = await prisma.product.create({
    data: {
      name: 'Chaveiro A', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 0.5, laborTimeHours: 0,
      componentUsages: { create: [{ componentProductId: mosquetao.id, quantity: 1 }] },
    },
  })
  const productB = await prisma.product.create({
    data: {
      name: 'Chaveiro B', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 0.5, laborTimeHours: 0,
      componentUsages: { create: [{ componentProductId: mosquetao.id, quantity: 1 }] },
    },
  })
  return { printer, filament, mosquetao, productA, productB }
}

async function assembleWithComponent(product: { id: string }, filament: { id: string }, componentProductId: string, quantity: number) {
  const result = await confirmAssembly(fd({
    productId: product.id,
    quantity: String(quantity),
    accessoryUsagesJson: '[]',
    supplyUsagesJson: '[]',
    colorChoicesJson: JSON.stringify({ [product.id]: filament.id, [componentProductId]: filament.id }),
  }))
  expect(result.success).toBe(true)
}

describe('Cascata: componente compartilhado entre produtos pai diferentes (Mosquetão)', () => {
  it('excluir a produção do componente desmonta os DOIS produtos pai, respeitando o livre de cada um', async () => {
    const { printer, filament, mosquetao, productA, productB } = await createSharedComponentScenario()
    const mosquetaoRun = await produce(mosquetao, printer, filament, 20)
    await produce(productA, printer, filament, 10)
    await produce(productB, printer, filament, 10)

    await assembleWithComponent(productA, filament, mosquetao.id, 6)
    await assembleWithComponent(productB, filament, mosquetao.id, 8)
    // 14 Mosquetões consumidos (6+8), 20 produzidos -- excluir a produção
    // inteira cria déficit de 14, coberto integralmente pela folga de A (6)
    // + B (8), nenhum dos dois vendeu nada ainda.

    const result = await deleteProductionRun(mosquetaoRun.id)
    expect(result.success).toBe(true)
    expect(result.reversedFrom).toHaveLength(2)
    const totalReversed = result.reversedFrom!.reduce((sum, r) => sum + r.unitsReversed, 0)
    expect(totalReversed).toBe(14)
    const names = result.reversedFrom!.map((r) => r.productName).sort()
    expect(names).toEqual(['Chaveiro A', 'Chaveiro B'])

    const statusA = await getAssemblyStatus(productA.id)
    expect(statusA.alreadyAssembled).toBe(0)
    const statusB = await getAssemblyStatus(productB.id)
    expect(statusB.alreadyAssembled).toBe(0)
  })

  it('bloqueia quando um dos produtos pai já vendeu (sem folga) -- nada muda em nenhum dos dois', async () => {
    const { printer, filament, mosquetao, productA, productB } = await createSharedComponentScenario()
    const mosquetaoRun = await produce(mosquetao, printer, filament, 20)
    await produce(productA, printer, filament, 10)
    await produce(productB, printer, filament, 10)

    await assembleWithComponent(productA, filament, mosquetao.id, 6)
    await assembleWithComponent(productB, filament, mosquetao.id, 8)

    const saleResult = await createSale(fd({ channel: 'DIRETA', productId: productA.id, quantity: '6', unitPrice: '10', saleDate: '2026-09-11' }))
    expect(saleResult.success).toBe(true)

    const assembliesBefore = await prisma.productAssembly.findMany({})

    const result = await deleteProductionRun(mosquetaoRun.id)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Chaveiro A')

    const runAfter = await prisma.productionRun.findUnique({ where: { id: mosquetaoRun.id } })
    expect(runAfter).not.toBeNull()

    const assembliesAfter = await prisma.productAssembly.findMany({})
    expect(assembliesAfter).toEqual(assembliesBefore)
  })
})

describe('Cascata: cancelar/excluir produção já consumida em montagem', () => {
  it('produção 100% consumida, sem venda depois -- cancelar desmonta e estorna acessório/insumo', async () => {
    const { printer, filament, accessory, supply, product } = await createSupportRecords()
    const run = await produce(product, printer, filament, 14)
    await assemble(product, filament, accessory, supply, 14)

    const accessoryBefore = (await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()
    const supplyBefore = (await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()
    expect(accessoryBefore).toBe(86) // 100 - 14*1
    expect(supplyBefore).toBe(36) // 50 - 14*1

    const result = await cancelProductionRun(run.id, 'erro de digitação')
    expect(result.success).toBe(true)

    const status = await getAssemblyStatus(product.id)
    expect(status.alreadyAssembled).toBe(0)
    expect(status.parts[0].produced).toBe(0)
    expect(status.parts[0].consumed).toBe(0)

    const stock = await getOwnStockSummary()
    const row = stock.find((s) => s.productId === product.id)!
    expect(row.available).toBe(0)

    const accessoryAfter = (await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()
    const supplyAfter = (await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()
    expect(accessoryAfter).toBe(100)
    expect(supplyAfter).toBe(50)

    const assemblies = await prisma.productAssembly.findMany({ where: { productId: product.id } })
    expect(assemblies).toHaveLength(0)
    const consumptions = await prisma.stockConsumption.findMany({ where: { productId: product.id } })
    expect(consumptions).toHaveLength(0)
  })

  it('bloqueia quando parte já foi vendida -- nada é alterado', async () => {
    const { printer, filament, accessory, supply, product } = await createSupportRecords()
    const run = await produce(product, printer, filament, 14)
    await assemble(product, filament, accessory, supply, 14)

    const saleResult = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '5',
      unitPrice: '20',
      saleDate: '2026-09-11',
    }))
    expect(saleResult.success).toBe(true)

    const stockBefore = await getOwnStockSummary()
    const rowBefore = stockBefore.find((s) => s.productId === product.id)!
    const assembliesBefore = await prisma.productAssembly.findMany({ where: { productId: product.id } })
    const accessoryBefore = (await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()

    const result = await cancelProductionRun(run.id, 'erro de digitação')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Chaveirinho')

    const runAfter = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(runAfter.status).not.toBe('CANCELADA')

    const stockAfter = await getOwnStockSummary()
    const rowAfter = stockAfter.find((s) => s.productId === product.id)!
    expect(rowAfter.available).toBe(rowBefore.available)

    const assembliesAfter = await prisma.productAssembly.findMany({ where: { productId: product.id } })
    expect(assembliesAfter).toHaveLength(assembliesBefore.length)
    expect(assembliesAfter[0]?.quantity).toBe(assembliesBefore[0]?.quantity)

    const accessoryAfter = (await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()
    expect(accessoryAfter).toBe(accessoryBefore)
  })

  it('déficit parcial (montagem consumiu menos que a produção cancelada) -- reversão parcial', async () => {
    const { printer, filament, accessory, supply, product } = await createSupportRecords()
    // 2 lotes de produção somando 20, mas só 8 foram montados -- cancelar
    // um lote de 14 deixa "produced" em 6, "consumed" continua 8: déficit
    // de 2, não os 14 inteiros.
    const run1 = await produce(product, printer, filament, 14)
    await produce(product, printer, filament, 6)
    await assemble(product, filament, accessory, supply, 8)

    const result = await cancelProductionRun(run1.id, 'erro de digitação')
    expect(result.success).toBe(true)

    const status = await getAssemblyStatus(product.id)
    expect(status.alreadyAssembled).toBe(6) // 8 - déficit de 2 revertido
    expect(status.parts[0].produced).toBe(6) // só o segundo lote (20-14)

    const assemblies = await prisma.productAssembly.findMany({ where: { productId: product.id } })
    expect(assemblies).toHaveLength(1)
    expect(assemblies[0].quantity).toBe(6)

    const accessoryAfter = (await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()
    expect(accessoryAfter).toBe(94) // 100 - 8 (montagem) + 2 (revertido)
  })

  it('produção com folga (outro lote cobre o já montado) -- nenhuma ProductAssembly é tocada', async () => {
    const { printer, filament, accessory, supply, product } = await createSupportRecords()
    const run1 = await produce(product, printer, filament, 14)
    await produce(product, printer, filament, 6) // segundo lote cobre sozinho os 5 já montados
    await assemble(product, filament, accessory, supply, 5)

    const assembliesBefore = await prisma.productAssembly.findMany({ where: { productId: product.id } })

    const result = await cancelProductionRun(run1.id, 'erro de digitação')
    expect(result.success).toBe(true)

    const assembliesAfter = await prisma.productAssembly.findMany({ where: { productId: product.id } })
    expect(assembliesAfter).toEqual(assembliesBefore)

    const status = await getAssemblyStatus(product.id)
    expect(status.alreadyAssembled).toBe(5)
    expect(status.parts[0].produced).toBe(6) // só o segundo lote (20-14)
  })

  it('deleteProductionRun (excluir, não só cancelar) também desmonta e estorna', async () => {
    const { printer, filament, accessory, supply, product } = await createSupportRecords()
    const run = await produce(product, printer, filament, 14)
    await assemble(product, filament, accessory, supply, 14)

    const result = await deleteProductionRun(run.id)
    expect(result.success).toBe(true)

    const runAfter = await prisma.productionRun.findUnique({ where: { id: run.id } })
    expect(runAfter).toBeNull()

    const status = await getAssemblyStatus(product.id)
    expect(status.alreadyAssembled).toBe(0)

    const accessoryAfter = (await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()
    expect(accessoryAfter).toBe(100)
  })
})
