import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createPackagingItem, updatePackagingItem, registerPackagingPurchase, deletePackagingItem, reactivatePackagingItem } from '@/actions/packaging'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await prisma.packagingItem.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('packaging actions', () => {
  it('cria uma embalagem válida (cadastro = primeira compra)', async () => {
    const result = await createPackagingItem(fd({
      name: 'Caixa Teste',
      quantity: '10',
      totalCost: '15',
      minStock: '2',
    }))
    expect(result.success).toBe(true)
    const item = await prisma.packagingItem.findFirst({ where: { name: 'Caixa Teste' } })
    expect(item).not.toBeNull()
    expect(item?.currentStock.toNumber()).toBe(10)
    expect(item?.avgUnitCost.toNumber()).toBeCloseTo(1.5, 6)
    expect(item?.minStock.toNumber()).toBe(2)
  })

  it('rejeita nome vazio', async () => {
    const result = await createPackagingItem(fd({
      name: '',
      quantity: '10',
      totalCost: '15',
      minStock: '0',
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza nome/estoque mínimo e depois remove (soft-delete)', async () => {
    const created = await createPackagingItem(fd({ name: 'Saco Teste', quantity: '20', totalCost: '6', minStock: '0' }))
    expect(created.success).toBe(true)
    const item = await prisma.packagingItem.findFirstOrThrow({ where: { name: 'Saco Teste' } })

    const updated = await updatePackagingItem(item.id, fd({ name: 'Saco Teste Atualizado', minStock: '5' }))
    expect(updated.success).toBe(true)
    const afterUpdate = await prisma.packagingItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(afterUpdate.name).toBe('Saco Teste Atualizado')
    expect(afterUpdate.minStock.toNumber()).toBe(5)

    const del = await deletePackagingItem(item.id)
    expect(del.success).toBe(true)
    // PackagingItem is referenced by Product, so deletePackagingItem soft-deletes
    // (active: false) instead of removing the row.
    const gone = await prisma.packagingItem.findUnique({ where: { id: item.id } })
    expect(gone).not.toBeNull()
    expect(gone?.active).toBe(false)
  })

  it('reativa uma embalagem removida (soft-deleted)', async () => {
    const created = await createPackagingItem(fd({ name: 'Caixa Reativação', quantity: '5', totalCost: '10', minStock: '0' }))
    expect(created.success).toBe(true)
    const item = await prisma.packagingItem.findFirstOrThrow({ where: { name: 'Caixa Reativação' } })

    await deletePackagingItem(item.id)
    const reactivated = await reactivatePackagingItem(item.id)
    expect(reactivated.success).toBe(true)

    const restored = await prisma.packagingItem.findUnique({ where: { id: item.id } })
    expect(restored?.active).toBe(true)
  })

  it('repõe estoque recalculando custo médio ponderado', async () => {
    const created = await createPackagingItem(fd({ name: 'Caixa Reposição', quantity: '10', totalCost: '10', minStock: '0' }))
    expect(created.success).toBe(true)
    const item = await prisma.packagingItem.findFirstOrThrow({ where: { name: 'Caixa Reposição' } })

    const restocked = await registerPackagingPurchase(fd({ packagingItemId: item.id, quantity: '10', totalCost: '20' }))
    expect(restocked.success).toBe(true)

    const after = await prisma.packagingItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(after.currentStock.toNumber()).toBe(20)
    // (10*1 + 20) / 20 = 1.5
    expect(after.avgUnitCost.toNumber()).toBeCloseTo(1.5, 6)
  })
})
