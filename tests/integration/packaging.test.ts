import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createPackagingItem, updatePackagingItem, deletePackagingItem } from '@/actions/packaging'

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
  it('cria uma embalagem válida', async () => {
    const result = await createPackagingItem(fd({
      name: 'Caixa Teste',
      unitCost: '1.5',
    }))
    expect(result.success).toBe(true)
    const item = await prisma.packagingItem.findFirst({ where: { name: 'Caixa Teste' } })
    expect(item).not.toBeNull()
  })

  it('rejeita nome vazio', async () => {
    const result = await createPackagingItem(fd({
      name: '',
      unitCost: '1.5',
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza e depois remove (soft-delete)', async () => {
    const created = await createPackagingItem(fd({ name: 'Saco Teste', unitCost: '0.3' }))
    expect(created.success).toBe(true)
    const item = await prisma.packagingItem.findFirstOrThrow({ where: { name: 'Saco Teste' } })

    const updated = await updatePackagingItem(item.id, fd({ name: 'Saco Teste Atualizado', unitCost: '0.35' }))
    expect(updated.success).toBe(true)

    const del = await deletePackagingItem(item.id)
    expect(del.success).toBe(true)
    // PackagingItem is referenced by Product, so deletePackagingItem soft-deletes
    // (active: false) instead of removing the row.
    const gone = await prisma.packagingItem.findUnique({ where: { id: item.id } })
    expect(gone).not.toBeNull()
    expect(gone?.active).toBe(false)
  })
})
