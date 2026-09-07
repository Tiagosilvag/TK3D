import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createSupply, registerSupplyPurchase, deleteSupply } from '@/actions/supplies'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  // SupplyPurchase cascades from Supply (onDelete: Cascade), so clearing
  // Supply itself is enough for that table. Product/Printer/Filament are
  // also cleared because the FK-propagation test below creates one of each
  // (plus a ProductSupplyUsage) to reference a Supply -- left behind, they'd
  // break a second run (Filament/Printer names are unique) and pollute
  // sibling suites, same reasoning as accessories.test.ts's own cleanup().
  await prisma.productSupplyUsage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.supply.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('createSupply', () => {
  it('cria o Supply E a primeira SupplyPurchase na mesma operação', async () => {
    const result = await createSupply(fd({
      name: 'Cola Tekbond Teste',
      unit: 'ML',
      quantity: '100',
      totalCost: '10',
      purchaseDate: '2026-01-10',
    }))
    expect(result.success).toBe(true)

    const item = await prisma.supply.findFirstOrThrow({ where: { name: 'Cola Tekbond Teste' } })
    // avgUnitCost = totalCost/quantity = 10/100 = 0.1, currentStock = quantity = 100
    expect(item.currentStock.toNumber()).toBeCloseTo(100, 4)
    expect(item.avgUnitCost.toNumber()).toBeCloseTo(0.1, 4)
    expect(item.active).toBe(true)

    const purchases = await prisma.supplyPurchase.findMany({ where: { supplyId: item.id } })
    expect(purchases).toHaveLength(1)
    expect(purchases[0].quantity.toNumber()).toBeCloseTo(100, 4)
    expect(purchases[0].totalCost.toNumber()).toBeCloseTo(10, 4)
  })

  it('aceita as novas unidades M (metro) e OUTRO', async () => {
    const metro = await createSupply(fd({
      name: 'Fita métrica Teste', unit: 'M', quantity: '10', totalCost: '20', purchaseDate: '2026-01-10',
    }))
    expect(metro.success).toBe(true)
    const outro = await createSupply(fd({
      name: 'Insumo Genérico Teste', unit: 'OUTRO', quantity: '5', totalCost: '5', purchaseDate: '2026-01-10',
    }))
    expect(outro.success).toBe(true)

    const metroItem = await prisma.supply.findFirstOrThrow({ where: { name: 'Fita métrica Teste' } })
    expect(metroItem.unit).toBe('M')
    const outroItem = await prisma.supply.findFirstOrThrow({ where: { name: 'Insumo Genérico Teste' } })
    expect(outroItem.unit).toBe('OUTRO')
  })

  it('rejeita unidade inválida', async () => {
    const result = await createSupply(fd({
      name: 'Insumo Teste', unit: 'INVALIDO', quantity: '10', totalCost: '5', purchaseDate: '2026-01-10',
    }))
    expect(result.success).toBe(false)
  })

  it('rejeita quantidade zero ou negativa', async () => {
    const zero = await createSupply(fd({
      name: 'Insumo Zero', unit: 'UN', quantity: '0', totalCost: '8', purchaseDate: '2026-01-10',
    }))
    expect(zero.success).toBe(false)

    const negative = await createSupply(fd({
      name: 'Insumo Negativo', unit: 'UN', quantity: '-5', totalCost: '8', purchaseDate: '2026-01-10',
    }))
    expect(negative.success).toBe(false)
  })

  it('rejeita valor total zero ou negativo', async () => {
    const result = await createSupply(fd({
      name: 'Insumo Custo Zero', unit: 'UN', quantity: '10', totalCost: '0', purchaseDate: '2026-01-10',
    }))
    expect(result.success).toBe(false)
  })

  it('mesmo nome não pode duplicar (unique constraint)', async () => {
    const first = await createSupply(fd({
      name: 'Verniz Duplicado', unit: 'ML', quantity: '10', totalCost: '5', purchaseDate: '2026-01-10',
    }))
    expect(first.success).toBe(true)

    const duplicate = await createSupply(fd({
      name: 'Verniz Duplicado', unit: 'ML', quantity: '20', totalCost: '10', purchaseDate: '2026-01-11',
    }))
    expect(duplicate.success).toBe(false)

    // No second row, and no orphaned purchase from the failed attempt.
    const rows = await prisma.supply.findMany({ where: { name: 'Verniz Duplicado' } })
    expect(rows).toHaveLength(1)
    const purchases = await prisma.supplyPurchase.findMany({ where: { supplyId: rows[0].id } })
    expect(purchases).toHaveLength(1)
  })
})

describe('registerSupplyPurchase', () => {
  it('recalcula avgUnitCost pela média ponderada e incrementa currentStock (hand-computed)', async () => {
    const created = await createSupply(fd({
      name: 'Cola Reposição', unit: 'ML', quantity: '100', totalCost: '50', purchaseDate: '2026-01-01',
    }))
    expect(created.success).toBe(true)
    const before = await prisma.supply.findFirstOrThrow({ where: { name: 'Cola Reposição' } })
    expect(before.currentStock.toNumber()).toBeCloseTo(100, 4)
    expect(before.avgUnitCost.toNumber()).toBeCloseTo(0.5, 4)

    // Segunda compra: 50ml por R$30 (R$0.60/ml).
    // hand-compute: (100*0.5 + 30) / (100+50) = (50+30)/150 = 80/150 = 0.533333...
    const purchase = await registerSupplyPurchase(fd({
      supplyId: before.id,
      quantity: '50',
      totalCost: '30',
      purchaseDate: '2026-02-01',
    }))
    expect(purchase.success).toBe(true)

    const after = await prisma.supply.findUniqueOrThrow({ where: { id: before.id } })
    expect(after.currentStock.toNumber()).toBeCloseTo(150, 4)
    // avgUnitCost is stored as Decimal(10,4) -- 80/150 = 0.5333... rounds to
    // 0.5333 at that precision, so the assertion can't ask for more digits
    // than the column itself keeps.
    expect(after.avgUnitCost.toNumber()).toBeCloseTo(80 / 150, 4)

    const purchases = await prisma.supplyPurchase.findMany({ where: { supplyId: before.id }, orderBy: { purchaseDate: 'asc' } })
    expect(purchases).toHaveLength(2)
    expect(purchases[1].quantity.toNumber()).toBeCloseTo(50, 4)
    expect(purchases[1].totalCost.toNumber()).toBeCloseTo(30, 4)
  })

  it('rejeita quantidade zero ou negativa (não decrementa/zera estoque)', async () => {
    await createSupply(fd({
      name: 'Insumo Validação', unit: 'UN', quantity: '10', totalCost: '10', purchaseDate: '2026-01-01',
    }))
    const item = await prisma.supply.findFirstOrThrow({ where: { name: 'Insumo Validação' } })

    const zero = await registerSupplyPurchase(fd({ supplyId: item.id, quantity: '0', totalCost: '5', purchaseDate: '2026-01-02' }))
    expect(zero.success).toBe(false)
    const negative = await registerSupplyPurchase(fd({ supplyId: item.id, quantity: '-10', totalCost: '5', purchaseDate: '2026-01-02' }))
    expect(negative.success).toBe(false)

    // Stock untouched by the rejected attempts -- there is no code path in
    // this action set that can subtract from currentStock (the actual
    // consumption/decrement happens in a later task), so a rejected
    // "purchase" must leave stock exactly as it was, never negative.
    const unchanged = await prisma.supply.findUniqueOrThrow({ where: { id: item.id } })
    expect(unchanged.currentStock.toNumber()).toBeCloseTo(10, 4)
  })

  it('rejeita valor total zero ou negativo', async () => {
    await createSupply(fd({
      name: 'Insumo Validação Custo', unit: 'UN', quantity: '10', totalCost: '10', purchaseDate: '2026-01-01',
    }))
    const item = await prisma.supply.findFirstOrThrow({ where: { name: 'Insumo Validação Custo' } })

    const result = await registerSupplyPurchase(fd({ supplyId: item.id, quantity: '5', totalCost: '0', purchaseDate: '2026-01-02' }))
    expect(result.success).toBe(false)
    const unchanged = await prisma.supply.findUniqueOrThrow({ where: { id: item.id } })
    expect(unchanged.currentStock.toNumber()).toBeCloseTo(10, 4)
  })
})

describe('deleteSupply', () => {
  it('remove fisicamente um insumo não referenciado', async () => {
    await createSupply(fd({ name: 'Insumo Removível', unit: 'UN', quantity: '10', totalCost: '5', purchaseDate: '2026-01-01' }))
    const item = await prisma.supply.findFirstOrThrow({ where: { name: 'Insumo Removível' } })

    const result = await deleteSupply(item.id)
    expect(result.success).toBe(true)

    const gone = await prisma.supply.findUnique({ where: { id: item.id } })
    expect(gone).toBeNull()
  })

  it('propaga o erro de FK quando o insumo está referenciado por um Product (via ProductSupplyUsage)', async () => {
    await createSupply(fd({ name: 'Insumo Referenciado', unit: 'UN', quantity: '10', totalCost: '5', purchaseDate: '2026-01-01' }))
    const item = await prisma.supply.findFirstOrThrow({ where: { name: 'Insumo Referenciado' } })

    const printer = await prisma.printer.create({ data: { name: 'Impressora Teste Insumo', purchasePrice: 1000, depreciationHours: 5000, avgPowerConsumptionKwh: 0.2 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const product = await prisma.product.create({ data: { name: 'Produto Teste Insumo', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0.1 } })
    await prisma.productSupplyUsage.create({ data: { productId: product.id, supplyId: item.id, quantity: 1 } })

    await expect(deleteSupply(item.id)).rejects.toThrow()

    const stillThere = await prisma.supply.findUnique({ where: { id: item.id } })
    expect(stillThere).not.toBeNull()
  })
})
