import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProductFromQuickCalc } from '@/actions/quickCalculator'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.productPartFilament.deleteMany()
  await prisma.productPart.deleteMany()
  await prisma.productSupplyUsage.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.supply.deleteMany()
  await prisma.accessory.deleteMany()
  await prisma.settings.deleteMany()
}

beforeAll(async () => {
  await prisma.$connect()
})
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => {
  await prisma.$disconnect()
})

describe('createProductFromQuickCalc', () => {
  it('1 filamento só -- cria Product simples (isComposite=false), sem ProductPart', async () => {
    await prisma.settings.create({ data: { id: 1 } })
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27, energyCostPerKwh: 1, maintenanceCostPerHour: 0.18 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 0.08 } })

    const result = await createProductFromQuickCalc({
      name: 'Chaveiro Simples',
      category: 'Chaveiro',
      filamentComponents: [{ filamentId: filament.id, weightGrams: 10 }],
      printerId: printer.id,
      printTimeHours: 1,
      laborTimeHours: 5 / 60,
      supplyUsages: [],
      accessoryUsages: [],
    })

    expect(result.success).toBe(true)
    const product = await prisma.product.findUniqueOrThrow({ where: { id: result.productId }, include: { parts: true } })
    expect(product.isComposite).toBe(false)
    expect(product.filamentId).toBe(filament.id)
    expect(product.weightGrams.toNumber()).toBe(10)
    expect(product.parts).toHaveLength(0)
  })

  it('2+ filamentos -- cria Product composto com 1 ProductPart multi-filamento (quantityPerUnit=1)', async () => {
    await prisma.settings.create({ data: { id: 1 } })
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27, energyCostPerKwh: 1, maintenanceCostPerHour: 0.18 } })
    const black = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 0.08 } })
    const green = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Verde', colorHex: '#00ff00', currentStockGrams: 1000, avgUnitCostPerGram: 0.12 } })

    const result = await createProductFromQuickCalc({
      name: 'Cubo Bicolor',
      category: 'Fidget',
      filamentComponents: [
        { filamentId: black.id, weightGrams: 15 },
        { filamentId: green.id, weightGrams: 8 },
      ],
      printerId: printer.id,
      printTimeHours: 2,
      laborTimeHours: 5 / 60,
      supplyUsages: [],
      accessoryUsages: [],
    })

    expect(result.success).toBe(true)
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: result.productId },
      include: { parts: { include: { filamentComponents: true } } },
    })
    expect(product.isComposite).toBe(true)
    // Resumo derivado: peso total somado, 1º componente como filamentId.
    expect(product.weightGrams.toNumber()).toBe(23)
    expect(product.filamentId).toBe(black.id)
    expect(product.parts).toHaveLength(1)
    expect(product.parts[0].quantityPerUnit).toBe(1)
    expect(product.parts[0].filamentComponents).toHaveLength(2)
    const weights = product.parts[0].filamentComponents.map((c) => ({ filamentId: c.filamentId, weightGrams: c.weightGrams.toNumber() })).sort((a, b) => a.filamentId.localeCompare(b.filamentId))
    expect(weights).toEqual(
      [
        { filamentId: black.id, weightGrams: 15 },
        { filamentId: green.id, weightGrams: 8 },
      ].sort((a, b) => a.filamentId.localeCompare(b.filamentId)),
    )
  })

  it('rejeita quando nenhum filamento é selecionado', async () => {
    await prisma.settings.create({ data: { id: 1 } })
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27, energyCostPerKwh: 1, maintenanceCostPerHour: 0.18 } })

    const result = await createProductFromQuickCalc({
      name: 'Sem filamento',
      category: 'Chaveiro',
      filamentComponents: [],
      printerId: printer.id,
      printTimeHours: 1,
      laborTimeHours: 0,
      supplyUsages: [],
      accessoryUsages: [],
    })

    expect(result.success).toBe(false)
  })
})
