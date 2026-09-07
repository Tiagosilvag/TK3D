import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createAccessory, updateAccessory, deleteAccessory, reactivateAccessory } from '@/actions/accessories'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await prisma.accessory.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('accessories actions', () => {
  it('cria um acessório válido', async () => {
    const result = await createAccessory(fd({
      name: 'Mosquetão Teste',
      type: 'MOSQUETAO',
      unitCost: '0.8',
    }))
    expect(result.success).toBe(true)
    const item = await prisma.accessory.findFirst({ where: { name: 'Mosquetão Teste' } })
    expect(item).not.toBeNull()
  })

  it('rejeita tipo inválido', async () => {
    const result = await createAccessory(fd({
      name: 'Acessório Teste',
      type: 'INVALIDO',
      unitCost: '0.8',
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza e depois remove (soft-delete)', async () => {
    const created = await createAccessory(fd({ name: 'Clicker Teste', type: 'CLICKER', unitCost: '0.5' }))
    expect(created.success).toBe(true)
    const item = await prisma.accessory.findFirstOrThrow({ where: { name: 'Clicker Teste' } })

    const updated = await updateAccessory(item.id, fd({ name: 'Clicker Teste Atualizado', type: 'CLICKER', unitCost: '0.6' }))
    expect(updated.success).toBe(true)

    const del = await deleteAccessory(item.id)
    expect(del.success).toBe(true)
    // Accessory is referenced by Product, so deleteAccessory soft-deletes
    // (active: false) instead of removing the row.
    const gone = await prisma.accessory.findUnique({ where: { id: item.id } })
    expect(gone).not.toBeNull()
    expect(gone?.active).toBe(false)
  })

  it('reativa um acessório removido (soft-deleted)', async () => {
    const created = await createAccessory(fd({ name: 'Mosquetão Reativação', type: 'MOSQUETAO', unitCost: '0.9' }))
    expect(created.success).toBe(true)
    const item = await prisma.accessory.findFirstOrThrow({ where: { name: 'Mosquetão Reativação' } })

    await deleteAccessory(item.id)
    const reactivated = await reactivateAccessory(item.id)
    expect(reactivated.success).toBe(true)

    const restored = await prisma.accessory.findUnique({ where: { id: item.id } })
    expect(restored?.active).toBe(true)
  })
})
