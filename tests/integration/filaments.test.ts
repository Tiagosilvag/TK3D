import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createFilament, updateFilament, registerFilamentPurchase, deleteFilament } from '@/actions/filaments'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await prisma.filament.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

const validInput = {
  manufacturer: 'Teste 3Dmax',
  material: 'PLA',
  colorName: 'Vermelho',
  colorHex: '#ff0000',
  weightKg: '1',
  totalCost: '80',
  purchaseDate: '2026-01-01',
}

describe('filaments actions', () => {
  it('cria um filamento válido = primeira compra (estoque em gramas + custo médio + 1 FilamentPurchase)', async () => {
    const result = await createFilament(fd(validInput))
    expect(result.success).toBe(true)

    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste 3Dmax' }, include: { purchases: true } })
    expect(filament.currentStockGrams.toNumber()).toBe(1000)
    expect(filament.avgUnitCostPerGram.toNumber()).toBeCloseTo(0.08, 4)
    expect(filament.material).toBe('PLA')
    expect(filament.colorName).toBe('Vermelho')
    expect(filament.colorHex).toBe('#ff0000')
    expect(filament.purchases).toHaveLength(1)
    expect(filament.purchases[0].weightGrams.toNumber()).toBe(1000)
    expect(filament.purchases[0].totalCost.toNumber()).toBe(80)
  })

  it('recusa criar um filamento com marca+material+cor já cadastrados -- só "Repor estoque" nele', async () => {
    await createFilament(fd(validInput))
    const second = await createFilament(fd({ ...validInput, totalCost: '85' }))
    expect(second.success).toBe(false)

    const count = await prisma.filament.count({ where: { manufacturer: 'Teste 3Dmax', material: 'PLA', colorName: 'Vermelho' } })
    expect(count).toBe(1)
  })

  it('permite a mesma marca+material com cor diferente', async () => {
    await createFilament(fd(validInput))
    const result = await createFilament(fd({ ...validInput, colorName: 'Azul', colorHex: '#0000ff' }))
    expect(result.success).toBe(true)

    const count = await prisma.filament.count({ where: { manufacturer: 'Teste 3Dmax', material: 'PLA' } })
    expect(count).toBe(2)
  })

  it('rejeita fabricante vazio', async () => {
    const result = await createFilament(fd({ ...validInput, manufacturer: '' }))
    expect(result.success).toBe(false)
  })

  it('rejeita cor hexadecimal inválida', async () => {
    const result = await createFilament(fd({ ...validInput, colorHex: 'vermelho' }))
    expect(result.success).toBe(false)
  })

  it('registerFilamentPurchase soma estoque e recalcula o custo médio ponderado', async () => {
    await createFilament(fd(validInput))
    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste 3Dmax' } })

    // 1kg a R$80 já em estoque + 1kg a R$120 nesta compra -> 2000g por
    // R$200 total = R$0,10/g de média (calculateWeightedAverageCost).
    const result = await registerFilamentPurchase(fd({ filamentId: filament.id, weightKg: '1', totalCost: '120', purchaseDate: '2026-02-01' }))
    expect(result.success).toBe(true)

    const updated = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id }, include: { purchases: true } })
    expect(updated.currentStockGrams.toNumber()).toBe(2000)
    expect(updated.avgUnitCostPerGram.toNumber()).toBeCloseTo(0.1, 4)
    expect(updated.purchases).toHaveLength(2)
  })

  it('updateFilament corrige marca/material/cor sem tocar em estoque/custo', async () => {
    await createFilament(fd(validInput))
    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste 3Dmax' } })

    const result = await updateFilament(filament.id, fd({ manufacturer: 'Teste 3Dmax Corrigido', material: 'PLA', colorName: 'Vermelho', colorHex: '#ff0000' }))
    expect(result.success).toBe(true)

    const updated = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })
    expect(updated.manufacturer).toBe('Teste 3Dmax Corrigido')
    expect(updated.currentStockGrams.toNumber()).toBe(1000)
    expect(updated.avgUnitCostPerGram.toNumber()).toBeCloseTo(0.08, 4)
  })

  it('remove um filamento com estoque (exclusão física)', async () => {
    await createFilament(fd(validInput))
    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste 3Dmax' } })

    const del = await deleteFilament(filament.id)
    expect(del.success).toBe(true)

    const gone = await prisma.filament.findUnique({ where: { id: filament.id } })
    expect(gone).toBeNull()
  })

  it('recusa excluir um filamento esgotado (histórico é mantido automaticamente)', async () => {
    await createFilament(fd(validInput))
    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste 3Dmax' } })
    await prisma.filament.update({ where: { id: filament.id }, data: { currentStockGrams: 0 } })

    const del = await deleteFilament(filament.id)
    expect(del.success).toBe(false)

    const stillThere = await prisma.filament.findUnique({ where: { id: filament.id } })
    expect(stillThere).not.toBeNull()
  })
})
