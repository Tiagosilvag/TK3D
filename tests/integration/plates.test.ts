import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProductionRun, createPlate, updateProductionRun } from '@/actions/productionRuns'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.productionRun.deleteMany()
  await prisma.plate.deleteMany()
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
  // depreciationCostPerHour = purchasePrice / depreciationHours = 2000/1000 = R$2/h;
  // maintenance e energia zerados -- deixa printerCost = 2 * printTimeHours puro,
  // sem outros termos poluindo a conta do rateio (REGRA 11/21).
  const printer = await prisma.printer.create({
    data: { name: 'Impressora Plate', purchasePrice: 2000, depreciationHours: 1000, maintenanceCostPerHour: 0, avgPowerConsumptionKwh: 0, energyCostPerKwh: 0 },
  })
  const filamentA = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const filamentB = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Branco', colorHex: '#FFFFFF', rollNumber: 2, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  // Mosquetão: 30% do peso da Plate no exemplo do pedido.
  const productA = await prisma.product.create({
    data: { name: 'Mosquetão', category: 'Chaveiro', printerId: printer.id, filamentId: filamentA.id, weightGrams: 10, printTimeHours: 0.3, laborTimeHours: 0 },
  })
  // Caneca: 70% do peso da Plate no exemplo do pedido.
  const productB = await prisma.product.create({
    data: { name: 'Caneca', category: 'Utilidades', printerId: printer.id, filamentId: filamentB.id, weightGrams: 50, printTimeHours: 0.7, laborTimeHours: 0 },
  })
  return { printer, filamentA, filamentB, productA, productB }
}

describe('createPlate (reformulação Produção)', () => {
  it('cria a Plate e uma ProductionRun por item, ambas herdando data/impressora da Plate, cobrindo produtos DIFERENTES (REGRA 9)', async () => {
    const { printer, filamentA, filamentB, productA, productB } = await createSupportRecords()

    const result = await createPlate(fd({
      date: '2026-09-11',
      printerId: printer.id,
      notes: '',
      itemsJson: JSON.stringify([
        { productId: productA.id, productPartId: null, quantityPlanned: 1, quantitySuccess: 1, filaments: [{ filamentId: filamentA.id, weightGramsPerUnit: 10, gramsWasted: 0 }], timeWastedHours: 0 },
        { productId: productB.id, productPartId: null, quantityPlanned: 1, quantitySuccess: 1, filaments: [{ filamentId: filamentB.id, weightGramsPerUnit: 50, gramsWasted: 0 }], timeWastedHours: 0 },
      ]),
    }))
    expect(result.success).toBe(true)

    const plate = await prisma.plate.findFirstOrThrow()
    expect(plate.printerId).toBe(printer.id)
    expect(plate.date.toISOString().slice(0, 10)).toBe('2026-09-11')

    const runs = await prisma.productionRun.findMany({ where: { plateId: plate.id }, orderBy: { productId: 'asc' } })
    expect(runs).toHaveLength(2)
    for (const run of runs) {
      expect(run.plateId).toBe(plate.id)
      expect(run.printerId).toBe(printer.id)
      expect(run.date.toISOString().slice(0, 10)).toBe('2026-09-11')
    }
    expect(new Set(runs.map((r) => r.productId))).toEqual(new Set([productA.id, productB.id]))
  })

  it('rateia o custo de impressora proporcionalmente a tempo × quantidade (REGRA 11/21), reproduzindo o exemplo Mosquetão 30% / Caneca 70%', async () => {
    const { printer, filamentA, filamentB, productA, productB } = await createSupportRecords()

    const result = await createPlate(fd({
      date: '2026-09-11',
      printerId: printer.id,
      notes: '',
      itemsJson: JSON.stringify([
        { productId: productA.id, productPartId: null, quantityPlanned: 1, quantitySuccess: 1, filaments: [{ filamentId: filamentA.id, weightGramsPerUnit: 10, gramsWasted: 0 }], timeWastedHours: 0 },
        { productId: productB.id, productPartId: null, quantityPlanned: 1, quantitySuccess: 1, filaments: [{ filamentId: filamentB.id, weightGramsPerUnit: 50, gramsWasted: 0 }], timeWastedHours: 0 },
      ]),
    }))
    expect(result.success).toBe(true)

    const runA = await prisma.productionRun.findFirstOrThrow({ where: { productId: productA.id } })
    const runB = await prisma.productionRun.findFirstOrThrow({ where: { productId: productB.id } })
    const snapshotA = runA.costSnapshot as any
    const snapshotB = runB.costSnapshot as any

    // allocatePlatePrintTime([{0.3,1},{0.7,1}]) = [0.21, 0.49] (unit-tested em
    // tests/unit/costing.test.ts) -- printerCost = 2/h × tempo alocado.
    expect(snapshotA.unitCost.printerCost).toBeCloseTo(2 * 0.21, 5)
    expect(snapshotB.unitCost.printerCost).toBeCloseTo(2 * 0.49, 5)
    // Custo de impressora rateado NUNCA soma o valor cheio de cada peça
    // (2*0.3 + 2*0.7 = 2) -- soma o tempo real da Plate (2*0.7=1.4).
    expect(snapshotA.unitCost.printerCost + snapshotB.unitCost.printerCost).toBeCloseTo(2 * 0.7, 5)

    // REGRA 15/16: o "Tempo de impressão esperado" do catálogo nunca é
    // alterado pelo rateio -- só o cálculo de custo usa o tempo alocado.
    const catalogA = await prisma.product.findUniqueOrThrow({ where: { id: productA.id } })
    const catalogB = await prisma.product.findUniqueOrThrow({ where: { id: productB.id } })
    expect(catalogA.printTimeHours.toNumber()).toBe(0.3)
    expect(catalogB.printTimeHours.toNumber()).toBe(0.7)
  })

  it('custo de filamento NUNCA é rateado (REGRA 10/19) -- cada peça paga 100% do seu próprio consumo', async () => {
    const { printer, filamentA, filamentB, productA, productB } = await createSupportRecords()

    await createPlate(fd({
      date: '2026-09-11',
      printerId: printer.id,
      notes: '',
      itemsJson: JSON.stringify([
        { productId: productA.id, productPartId: null, quantityPlanned: 1, quantitySuccess: 1, filaments: [{ filamentId: filamentA.id, weightGramsPerUnit: 10, gramsWasted: 0 }], timeWastedHours: 0 },
        { productId: productB.id, productPartId: null, quantityPlanned: 1, quantitySuccess: 1, filaments: [{ filamentId: filamentB.id, weightGramsPerUnit: 50, gramsWasted: 0 }], timeWastedHours: 0 },
      ]),
    }))

    const updatedA = await prisma.filament.findUniqueOrThrow({ where: { id: filamentA.id } })
    const updatedB = await prisma.filament.findUniqueOrThrow({ where: { id: filamentB.id } })
    expect(updatedA.currentStockGrams.toNumber()).toBe(1000 - 10)
    expect(updatedB.currentStockGrams.toNumber()).toBe(1000 - 50)
  })

  it('tudo ou nada: quando duas peças da Plate compartilham o mesmo filamento e juntas excedem o estoque, nenhuma é gravada', async () => {
    const { printer, filamentA, productA, productB } = await createSupportRecords()
    // Estoque baixo o bastante pra passar em cada peça isolada mas não somadas.
    await prisma.filament.update({ where: { id: filamentA.id }, data: { currentStockGrams: 15 } })

    const result = await createPlate(fd({
      date: '2026-09-11',
      printerId: printer.id,
      notes: '',
      itemsJson: JSON.stringify([
        { productId: productA.id, productPartId: null, quantityPlanned: 1, quantitySuccess: 1, filaments: [{ filamentId: filamentA.id, weightGramsPerUnit: 10, gramsWasted: 0 }], timeWastedHours: 0 },
        // productB usa o filamento A aqui de propósito, pra estourar o combinado (10+10=20 > 15).
        { productId: productB.id, productPartId: null, quantityPlanned: 1, quantitySuccess: 1, filaments: [{ filamentId: filamentA.id, weightGramsPerUnit: 10, gramsWasted: 0 }], timeWastedHours: 0 },
      ]),
    }))
    expect(result.success).toBe(false)

    expect(await prisma.plate.findFirst()).toBeNull()
    expect(await prisma.productionRun.findFirst()).toBeNull()
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filamentA.id } })).currentStockGrams.toNumber()).toBe(15)
  })
})

describe('updateProductionRun -- edição de consumo (gramsUsed), reformulação Produção §42', () => {
  async function createSingleRun() {
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const product = await prisma.product.create({
      data: { name: 'Peça simples', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 30, printTimeHours: 2, laborTimeHours: 0.25 },
    })
    await createProductionRun(fd({
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
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    return { printer, filament, product, run }
  }

  it('ajusta o estoque de filamento pela DIFERENÇA quando gramsUsed muda, sem alterar unitCost/total do costSnapshot', async () => {
    const { filament, run } = await createSingleRun()
    const oldSnapshot = run.costSnapshot as any
    // Estoque após criação: 1000 - (240+15) = 745.
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(745)

    const result = await updateProductionRun(run.id, fd({
      gramsUsed: '260', // +20g em relação ao registrado (240)
      gramsWasted: '15', // sem mudança
      timeWastedHours: '0.5',
      wasteReason: '',
      notes: '',
    }))
    expect(result.success).toBe(true)

    const updatedRun = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updatedRun.gramsUsed.toNumber()).toBe(260)
    // Estoque decrementado só pela diferença (+20g a mais consumidos): 745-20=725.
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(725)

    const newSnapshot = updatedRun.costSnapshot as any
    // unitCost/total são derivados do peso da FICHA TÉCNICA (weightGrams),
    // nunca do consumo real -- editar gramsUsed não pode mudar isso.
    expect(newSnapshot.unitCost).toEqual(oldSnapshot.unitCost)
    expect(newSnapshot.total).toBe(oldSnapshot.total)
    expect(newSnapshot.consumedResources.filament.gramsUsed).toBe(260)
  })

  it('omitir gramsUsed no formulário não altera o consumo já registrado (undefined = sem mudança)', async () => {
    const { filament, run } = await createSingleRun()

    const result = await updateProductionRun(run.id, fd({
      gramsWasted: '20', // só desperdício muda, +5g em relação ao registrado (15)
      timeWastedHours: '0.5',
      wasteReason: '',
      notes: '',
    }))
    expect(result.success).toBe(true)

    const updatedRun = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(updatedRun.gramsUsed.toNumber()).toBe(240) // inalterado
    expect(updatedRun.gramsWasted.toNumber()).toBe(20)
    // Estoque: 745 - 5 (só a diferença do desperdício) = 740.
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(740)
  })

  it('rejeita quando a diferença combinada (usado+desperdiçado) excede o estoque disponível, sem alterar nada', async () => {
    const { filament, run } = await createSingleRun()

    const result = await updateProductionRun(run.id, fd({
      gramsUsed: String(240 + 10000), // delta impossível de cobrir
      gramsWasted: '15',
      timeWastedHours: '0.5',
      wasteReason: '',
      notes: '',
    }))
    expect(result.success).toBe(false)

    const unchangedRun = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(unchangedRun.gramsUsed.toNumber()).toBe(240)
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(745)
  })
})
