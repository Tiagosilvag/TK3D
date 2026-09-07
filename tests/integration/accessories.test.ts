import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createAccessory, registerAccessoryPurchase, deleteAccessory } from '@/actions/accessories'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  // AccessoryPurchase cascades from Accessory (onDelete: Cascade), so
  // clearing Accessory itself is enough for that table. Product/Printer/
  // Filament are also cleared because the FK-propagation test below creates
  // one of each to reference an Accessory -- left behind, they'd break a
  // second run (Filament/Printer names are unique) and pollute sibling
  // suites, same reasoning as products.test.ts's own cleanup().
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.accessory.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('createAccessory', () => {
  it('cria o Accessory E a primeira AccessoryPurchase na mesma operação', async () => {
    const result = await createAccessory(fd({
      name: 'Mosquetão Teste',
      type: 'MOSQUETAO',
      colorName: '',
      quantity: '100',
      totalCost: '80',
      purchaseDate: '2026-01-10',
    }))
    expect(result.success).toBe(true)

    const item = await prisma.accessory.findFirstOrThrow({ where: { name: 'Mosquetão Teste' } })
    // avgUnitCost = totalCost/quantity = 80/100 = 0.8, currentStock = quantity = 100
    expect(item.currentStock.toNumber()).toBeCloseTo(100, 4)
    expect(item.avgUnitCost.toNumber()).toBeCloseTo(0.8, 4)
    expect(item.colorName).toBe('')
    expect(item.active).toBe(true)

    const purchases = await prisma.accessoryPurchase.findMany({ where: { accessoryId: item.id } })
    expect(purchases).toHaveLength(1)
    expect(purchases[0].quantity.toNumber()).toBeCloseTo(100, 4)
    expect(purchases[0].totalCost.toNumber()).toBeCloseTo(80, 4)
  })

  it('aceita cor (colorName + colorHex)', async () => {
    const result = await createAccessory(fd({
      name: 'Corrente Bolinha Teste',
      type: 'CORRENTE_BOLINHA',
      colorName: 'Dourado',
      colorHex: '#ffd700',
      quantity: '50',
      totalCost: '25',
      purchaseDate: '2026-01-10',
    }))
    expect(result.success).toBe(true)
    const item = await prisma.accessory.findFirstOrThrow({ where: { name: 'Corrente Bolinha Teste' } })
    expect(item.colorName).toBe('Dourado')
    expect(item.colorHex).toBe('#ffd700')
  })

  it('rejeita tipo inválido', async () => {
    const result = await createAccessory(fd({
      name: 'Acessório Teste',
      type: 'INVALIDO',
      quantity: '10',
      totalCost: '8',
      purchaseDate: '2026-01-10',
    }))
    expect(result.success).toBe(false)
  })

  it('rejeita quantidade zero ou negativa', async () => {
    const zero = await createAccessory(fd({
      name: 'Acessório Zero', type: 'MOSQUETAO', quantity: '0', totalCost: '8', purchaseDate: '2026-01-10',
    }))
    expect(zero.success).toBe(false)

    const negative = await createAccessory(fd({
      name: 'Acessório Negativo', type: 'MOSQUETAO', quantity: '-5', totalCost: '8', purchaseDate: '2026-01-10',
    }))
    expect(negative.success).toBe(false)
  })

  it('rejeita valor total zero ou negativo', async () => {
    const result = await createAccessory(fd({
      name: 'Acessório Custo Zero', type: 'MOSQUETAO', quantity: '10', totalCost: '0', purchaseDate: '2026-01-10',
    }))
    expect(result.success).toBe(false)
  })

  it('mesma cor+nome+tipo não pode duplicar (unique constraint)', async () => {
    const first = await createAccessory(fd({
      name: 'Clicker Duplicado', type: 'CLICKER', colorName: 'Prata', quantity: '10', totalCost: '5', purchaseDate: '2026-01-10',
    }))
    expect(first.success).toBe(true)

    const duplicate = await createAccessory(fd({
      name: 'Clicker Duplicado', type: 'CLICKER', colorName: 'Prata', quantity: '20', totalCost: '10', purchaseDate: '2026-01-11',
    }))
    expect(duplicate.success).toBe(false)

    // No second row, and no orphaned purchase from the failed attempt.
    const rows = await prisma.accessory.findMany({ where: { name: 'Clicker Duplicado' } })
    expect(rows).toHaveLength(1)
    const purchases = await prisma.accessoryPurchase.findMany({ where: { accessoryId: rows[0].id } })
    expect(purchases).toHaveLength(1)
  })

  it('cores diferentes = Accessory distintos, estoques independentes', async () => {
    const red = await createAccessory(fd({
      name: 'Clicker Cor', type: 'CLICKER', colorName: 'Vermelho', quantity: '10', totalCost: '5', purchaseDate: '2026-01-10',
    }))
    const blue = await createAccessory(fd({
      name: 'Clicker Cor', type: 'CLICKER', colorName: 'Azul', quantity: '30', totalCost: '15', purchaseDate: '2026-01-10',
    }))
    expect(red.success).toBe(true)
    expect(blue.success).toBe(true)

    const rows = await prisma.accessory.findMany({ where: { name: 'Clicker Cor' }, orderBy: { colorName: 'asc' } })
    expect(rows).toHaveLength(2)
    const [azul, vermelho] = rows
    expect(azul.colorName).toBe('Azul')
    expect(azul.currentStock.toNumber()).toBeCloseTo(30, 4)
    expect(vermelho.colorName).toBe('Vermelho')
    expect(vermelho.currentStock.toNumber()).toBeCloseTo(10, 4)
  })
})

describe('registerAccessoryPurchase', () => {
  it('recalcula avgUnitCost pela média ponderada e incrementa currentStock (hand-computed)', async () => {
    const created = await createAccessory(fd({
      name: 'Mosquetão Reposição', type: 'MOSQUETAO', quantity: '100', totalCost: '50', purchaseDate: '2026-01-01',
    }))
    expect(created.success).toBe(true)
    const before = await prisma.accessory.findFirstOrThrow({ where: { name: 'Mosquetão Reposição' } })
    expect(before.currentStock.toNumber()).toBeCloseTo(100, 4)
    expect(before.avgUnitCost.toNumber()).toBeCloseTo(0.5, 4)

    // Segunda compra: 50 unidades por R$30 (R$0.60/un).
    // hand-compute: (100*0.5 + 30) / (100+50) = (50+30)/150 = 80/150 = 0.533333...
    const purchase = await registerAccessoryPurchase(fd({
      accessoryId: before.id,
      quantity: '50',
      totalCost: '30',
      purchaseDate: '2026-02-01',
    }))
    expect(purchase.success).toBe(true)

    const after = await prisma.accessory.findUniqueOrThrow({ where: { id: before.id } })
    expect(after.currentStock.toNumber()).toBeCloseTo(150, 4)
    // avgUnitCost is stored as Decimal(10,4) -- 80/150 = 0.5333... rounds to
    // 0.5333 at that precision, so the assertion can't ask for more digits
    // than the column itself keeps.
    expect(after.avgUnitCost.toNumber()).toBeCloseTo(80 / 150, 4)

    const purchases = await prisma.accessoryPurchase.findMany({ where: { accessoryId: before.id }, orderBy: { purchaseDate: 'asc' } })
    expect(purchases).toHaveLength(2)
    expect(purchases[1].quantity.toNumber()).toBeCloseTo(50, 4)
    expect(purchases[1].totalCost.toNumber()).toBeCloseTo(30, 4)
  })

  it('rejeita quantidade zero ou negativa (não decrementa/zera estoque)', async () => {
    const created = await createAccessory(fd({
      name: 'Mosquetão Validação', type: 'MOSQUETAO', quantity: '10', totalCost: '10', purchaseDate: '2026-01-01',
    }))
    const item = await prisma.accessory.findFirstOrThrow({ where: { name: 'Mosquetão Validação' } })

    const zero = await registerAccessoryPurchase(fd({ accessoryId: item.id, quantity: '0', totalCost: '5', purchaseDate: '2026-01-02' }))
    expect(zero.success).toBe(false)
    const negative = await registerAccessoryPurchase(fd({ accessoryId: item.id, quantity: '-10', totalCost: '5', purchaseDate: '2026-01-02' }))
    expect(negative.success).toBe(false)

    // Stock untouched by the rejected attempts -- there is no code path in
    // this action set that can subtract from currentStock (the actual
    // consumption/decrement happens in Task 6), so a rejected "purchase"
    // must leave stock exactly as it was, never negative.
    const unchanged = await prisma.accessory.findUniqueOrThrow({ where: { id: item.id } })
    expect(unchanged.currentStock.toNumber()).toBeCloseTo(10, 4)
  })

  it('rejeita valor total zero ou negativo', async () => {
    const created = await createAccessory(fd({
      name: 'Mosquetão Validação Custo', type: 'MOSQUETAO', quantity: '10', totalCost: '10', purchaseDate: '2026-01-01',
    }))
    const item = await prisma.accessory.findFirstOrThrow({ where: { name: 'Mosquetão Validação Custo' } })

    const result = await registerAccessoryPurchase(fd({ accessoryId: item.id, quantity: '5', totalCost: '0', purchaseDate: '2026-01-02' }))
    expect(result.success).toBe(false)
    const unchanged = await prisma.accessory.findUniqueOrThrow({ where: { id: item.id } })
    expect(unchanged.currentStock.toNumber()).toBeCloseTo(10, 4)
  })
})

describe('deleteAccessory', () => {
  it('remove fisicamente um acessório não referenciado', async () => {
    await createAccessory(fd({ name: 'Clicker Removível', type: 'CLICKER', quantity: '10', totalCost: '5', purchaseDate: '2026-01-01' }))
    const item = await prisma.accessory.findFirstOrThrow({ where: { name: 'Clicker Removível' } })

    const result = await deleteAccessory(item.id)
    expect(result.success).toBe(true)

    const gone = await prisma.accessory.findUnique({ where: { id: item.id } })
    expect(gone).toBeNull()
  })

  it('propaga o erro de FK quando o acessório está referenciado por um Product', async () => {
    await createAccessory(fd({ name: 'Clicker Referenciado', type: 'CLICKER', quantity: '10', totalCost: '5', purchaseDate: '2026-01-01' }))
    const item = await prisma.accessory.findFirstOrThrow({ where: { name: 'Clicker Referenciado' } })

    const printer = await prisma.printer.create({ data: { name: 'Impressora Teste Acessório', purchasePrice: 1000, depreciationHours: 5000, avgPowerConsumptionKwh: 0.2 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    await prisma.product.create({ data: { name: 'Produto Teste', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0.1, accessoryId: item.id } })

    await expect(deleteAccessory(item.id)).rejects.toThrow()

    const stillThere = await prisma.accessory.findUnique({ where: { id: item.id } })
    expect(stillThere).not.toBeNull()
  })
})
