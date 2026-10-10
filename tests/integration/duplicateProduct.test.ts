import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { duplicateProduct } from '@/actions/products'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.productPartFilament.deleteMany()
  await prisma.productPart.deleteMany()
  await prisma.productSupplyUsage.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.productPackagingUsage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.supply.deleteMany()
  await prisma.accessory.deleteMany()
  await prisma.accessoryTypeRecord.deleteMany({ where: { name: 'Argola Teste' } })
  await prisma.packagingItem.deleteMany()
}

beforeAll(async () => {
  await prisma.$connect()
})
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => {
  await prisma.$disconnect()
})

describe('duplicateProduct', () => {
  it('clona a ficha técnica inteira (peças multi-filamento, insumo, acessório) num produto novo', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const preto = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 0.08 } })
    const verde = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Verde', colorHex: '#00ff00', currentStockGrams: 1000, avgUnitCostPerGram: 0.09 } })
    const supply = await prisma.supply.create({ data: { name: 'Cola', unit: 'ML', currentStock: 10, avgUnitCost: 0.3 } })
    const accessoryType = await prisma.accessoryTypeRecord.create({ data: { name: 'Argola Teste' } })
    const accessory = await prisma.accessory.create({ data: { name: 'Argola', type: accessoryType.id, currentStock: 10, avgUnitCost: 0.5 } })

    const original = await prisma.product.create({
      data: {
        name: 'Chaveiro Bicolor',
        category: 'Chaveiro',
        isComposite: true,
        printerId: printer.id,
        filamentId: preto.id,
        weightGrams: 23,
        printTimeHours: 2,
        laborTimeHours: 5 / 60,
        parts: {
          create: [{
            name: 'Corpo',
            printerId: printer.id,
            printTimeHours: 2,
            quantityPerUnit: 1,
            filamentComponents: { create: [{ filamentId: preto.id, weightGrams: 15 }, { filamentId: verde.id, weightGrams: 8 }] },
          }],
        },
        supplyUsages: { create: [{ supplyId: supply.id, quantity: 1 }] },
        accessoryUsages: { create: [{ accessoryId: accessory.id, quantity: 2 }] },
      },
    })

    const result = await duplicateProduct(original.id)
    expect(result.success).toBe(true)
    expect(result.productId).not.toBe(original.id)

    const clone = await prisma.product.findUniqueOrThrow({
      where: { id: result.productId },
      include: { parts: { include: { filamentComponents: true } }, supplyUsages: true, accessoryUsages: true },
    })

    expect(clone.name).toBe('Chaveiro Bicolor (cópia)')
    expect(clone.isComposite).toBe(true)
    expect(clone.weightGrams.toNumber()).toBe(23)
    expect(clone.active).toBe(true)
    // Preço aplicado nunca é copiado -- só gravado por ação explícita do
    // usuário ("Aplicar preço calculado"), mesma regra pra produto novo.
    expect(clone.suggestedPrice).toBeNull()

    expect(clone.parts).toHaveLength(1)
    expect(clone.parts[0].filamentComponents).toHaveLength(2)
    const weights = clone.parts[0].filamentComponents.map((c) => c.weightGrams.toNumber()).sort((a, b) => a - b)
    expect(weights).toEqual([8, 15])

    expect(clone.supplyUsages).toHaveLength(1)
    expect(clone.supplyUsages[0].supplyId).toBe(supply.id)
    expect(clone.accessoryUsages).toHaveLength(1)
    expect(clone.accessoryUsages[0].quantity.toNumber()).toBe(2)

    // Original intocado.
    const stillOriginal = await prisma.product.findUniqueOrThrow({ where: { id: original.id }, include: { parts: true } })
    expect(stillOriginal.name).toBe('Chaveiro Bicolor')
    expect(stillOriginal.parts).toHaveLength(1)
  })

  it('rejeita duplicar um produto inexistente', async () => {
    const result = await duplicateProduct('produto-inexistente')
    expect(result.success).toBe(false)
  })
})
