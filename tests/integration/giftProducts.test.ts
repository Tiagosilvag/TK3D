import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProduct, updateProduct, getGiftProductCostBreakdown, getGiftProductOptions } from '@/actions/products'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

// Nunca apaga accessoryTypeRecord além do próprio tipo criado aqui:
// 'MOSQUETAO' e os demais tipos vêm de uma migration de dados
// (20260908020000_accessory_types_table), fixture permanente do banco que
// outros arquivos de teste (accessories.test.ts, sales.test.ts) também
// assumem presente -- ver mesmo comentário em consignmentColorTracking.test.ts.
async function cleanup() {
  await prisma.saleGiftUsage.deleteMany()
  await prisma.productGiftMaterial.deleteMany()
  await prisma.productGiftEquipmentUsage.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.accessoryPurchase.deleteMany()
  await prisma.product.deleteMany()
  await prisma.accessory.deleteMany({ where: { name: 'Corrente Prata' } })
  await prisma.accessoryTypeRecord.deleteMany({ where: { name: 'Corrente' } })
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { laborCostPerHour: 10, defaultMarkup: 2, energyCostPerKwh: 1, failureRatePercent: 0.1, taxPercent: 0.055 },
    create: { id: 1 },
  })
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

async function createAccessoryWithStock() {
  const type = await prisma.accessoryTypeRecord.create({ data: { name: 'Corrente' } })
  const accessory = await prisma.accessory.create({
    data: {
      name: 'Corrente Prata',
      type: type.id,
      colorName: 'Prata',
      currentStock: 100,
      avgUnitCost: 0.8,
      purchases: { create: { quantity: 100, totalCost: 80, purchaseDate: new Date() } },
    },
  })
  return accessory
}

// Brinde (spec "Brinde reciclado no sistema"): produto sem preço, trilha de
// custeio própria (peça/material de custo livre + acessório real +
// equipamento rateado), nunca a de produto normal (Impressora/Filamento/
// ProductPart).
describe('createProduct/updateProduct com isGift=true', () => {
  it('cria um Brinde sem exigir impressora/filamento/peso/tempo do form, usando placeholder', async () => {
    // resolveGiftPlaceholder precisa de pelo menos 1 impressora e 1
    // filamento cadastrados no sistema (qualquer um) -- mesmo que nunca
    // sejam lidos por nenhum cálculo/tela de Brinde.
    await prisma.printer.create({ data: { name: 'P1', purchasePrice: 1000, depreciationHours: 5000, avgPowerConsumptionKwh: 0.2 } })
    await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })

    const result = await createProduct(fd({
      name: 'Chaveiro Purga Reciclada',
      category: 'Chaveiro',
      isGift: 'true',
      giftMaterialsJson: JSON.stringify([{ description: 'Purga reciclada', unitCost: 0 }]),
      giftEquipmentJson: '[]',
      giftAccessoriesJson: '[]',
    }))
    expect(result.success).toBe(true)

    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Chaveiro Purga Reciclada' } })
    expect(product.isGift).toBe(true)
    expect(product.isComposite).toBe(false)
    expect(product.weightGrams.toNumber()).toBe(0)
    expect(product.printTimeHours.toNumber()).toBe(0)
    // placeholder resolvido (não nulo -- coluna continua NOT NULL).
    expect(product.printerId).toBeTruthy()
    expect(product.filamentId).toBeTruthy()

    const materials = await prisma.productGiftMaterial.findMany({ where: { productId: product.id } })
    expect(materials).toHaveLength(1)
    expect(materials[0].description).toBe('Purga reciclada')
    expect(materials[0].unitCost.toNumber()).toBe(0)
  })

  it('rejeita criar Brinde quando não existe nenhuma impressora/filamento cadastrado', async () => {
    const result = await createProduct(fd({
      name: 'Brinde Sem Placeholder',
      category: 'Chaveiro',
      isGift: 'true',
      giftMaterialsJson: '[]',
      giftEquipmentJson: '[]',
      giftAccessoriesJson: '[]',
    }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('impressora')
  })

  it('getGiftProductCostBreakdown soma material (custo livre) + acessório real + equipamento rateado', async () => {
    await prisma.printer.create({ data: { name: 'P1', purchasePrice: 1000, depreciationHours: 5000, avgPowerConsumptionKwh: 0.2 } })
    await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    const accessory = await createAccessoryWithStock()

    const created = await createProduct(fd({
      name: 'Chaveiro Purga Reciclada 3x3',
      category: 'Chaveiro',
      isGift: 'true',
      giftEnergyCostPerKwh: '0.95',
      giftMaterialsJson: JSON.stringify([{ description: 'Purga reciclada', unitCost: 0 }]),
      giftEquipmentJson: JSON.stringify([
        { name: 'Soprador Térmico', purchasePrice: 120, usefulLifeUses: 3000, powerWatts: 2000, minutesPerUnit: 0.5 },
        { name: 'Forma de Silicone', purchasePrice: 35, usefulLifeUses: 500, powerWatts: 0, minutesPerUnit: 0 },
      ]),
      giftAccessoriesJson: JSON.stringify([{ accessoryId: accessory.id, quantity: 1 }]),
    }))
    expect(created.success).toBe(true)

    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Chaveiro Purga Reciclada 3x3' } })
    const breakdown = await getGiftProductCostBreakdown(product.id)

    expect(breakdown.materialsCost).toBe(0)
    expect(breakdown.accessoriesCost).toBeCloseTo(0.8, 6)
    const expectedEquipmentCost = 120 / 3000 + (2000 / 1000) * (0.5 / 60) * 0.95 + 35 / 500
    expect(breakdown.equipmentCost).toBeCloseTo(expectedEquipmentCost, 6)
    expect(breakdown.finalCost).toBeCloseTo(0.8 + expectedEquipmentCost, 6)
    // Bate com o exemplo do protótipo (Custo total do brinde: R$0,93).
    expect(breakdown.finalCost).toBeCloseTo(0.93, 2)
  })

  it('giftEnergyCostPerKwh nulo cai no fallback de Settings.energyCostPerKwh', async () => {
    await prisma.printer.create({ data: { name: 'P1', purchasePrice: 1000, depreciationHours: 5000, avgPowerConsumptionKwh: 0.2 } })
    await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    await prisma.settings.update({ where: { id: 1 }, data: { energyCostPerKwh: 2 } })

    await createProduct(fd({
      name: 'Brinde Sem Tarifa',
      category: 'Chaveiro',
      isGift: 'true',
      giftMaterialsJson: '[]',
      giftEquipmentJson: JSON.stringify([{ name: 'Soprador', purchasePrice: 100, usefulLifeUses: 1000, powerWatts: 1000, minutesPerUnit: 6 }]),
      giftAccessoriesJson: '[]',
    }))
    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Brinde Sem Tarifa' } })
    expect(product.giftEnergyCostPerKwh).toBeNull()

    const breakdown = await getGiftProductCostBreakdown(product.id)
    // energia = (1000/1000) * (6/60) * 2 (fallback Settings) = 0.2
    expect(breakdown.equipmentCost).toBeCloseTo(100 / 1000 + 0.2, 6)
  })

  it('updateProduct reconcilia materiais/equipamento/acessórios (delete-then-recreate)', async () => {
    await prisma.printer.create({ data: { name: 'P1', purchasePrice: 1000, depreciationHours: 5000, avgPowerConsumptionKwh: 0.2 } })
    await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    await createProduct(fd({
      name: 'Brinde Editável',
      category: 'Chaveiro',
      isGift: 'true',
      giftMaterialsJson: JSON.stringify([{ description: 'Material A', unitCost: 1 }]),
      giftEquipmentJson: '[]',
      giftAccessoriesJson: '[]',
    }))
    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Brinde Editável' } })

    const updated = await updateProduct(product.id, fd({
      name: 'Brinde Editável',
      category: 'Chaveiro',
      isGift: 'true',
      giftMaterialsJson: JSON.stringify([{ description: 'Material B', unitCost: 5 }]),
      giftEquipmentJson: '[]',
      giftAccessoriesJson: '[]',
    }))
    expect(updated.success).toBe(true)

    const materials = await prisma.productGiftMaterial.findMany({ where: { productId: product.id } })
    expect(materials).toHaveLength(1)
    expect(materials[0].description).toBe('Material B')
    expect(materials[0].unitCost.toNumber()).toBe(5)
  })

  it('getGiftProductOptions só lista produtos isGift=true ativos', async () => {
    await prisma.printer.create({ data: { name: 'P1', purchasePrice: 1000, depreciationHours: 5000, avgPowerConsumptionKwh: 0.2 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    const printer = await prisma.printer.findFirstOrThrow()
    await createProduct(fd({
      name: 'Brinde Listado',
      category: 'Chaveiro',
      isGift: 'true',
      giftMaterialsJson: JSON.stringify([{ description: 'M', unitCost: 2 }]),
      giftEquipmentJson: '[]',
      giftAccessoriesJson: '[]',
    }))
    // produto normal, não deve aparecer na lista de brindes.
    await prisma.product.create({
      data: { name: 'Produto Normal', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 },
    })

    const options = await getGiftProductOptions()
    expect(options).toHaveLength(1)
    expect(options[0].name).toBe('Brinde Listado')
    expect(options[0].unitCost).toBeCloseTo(2, 6)
  })
})
