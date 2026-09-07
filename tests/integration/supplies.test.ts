import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createSupply, updateSupply, deleteSupply, reactivateSupply } from '@/actions/supplies'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await prisma.supply.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('supplies actions', () => {
  it('cria um insumo válido', async () => {
    const result = await createSupply(fd({
      name: 'Cola Teste',
      unit: 'ML',
      unitCost: '0.1',
    }))
    expect(result.success).toBe(true)
    const item = await prisma.supply.findFirst({ where: { name: 'Cola Teste' } })
    expect(item).not.toBeNull()
  })

  it('rejeita unidade inválida', async () => {
    const result = await createSupply(fd({
      name: 'Insumo Teste',
      unit: 'INVALIDO',
      unitCost: '0.1',
    }))
    expect(result.success).toBe(false)
  })

  it('aceita custo zero (não-negativo)', async () => {
    const result = await createSupply(fd({
      name: 'Insumo Gratuito',
      unit: 'UN',
      unitCost: '0',
    }))
    expect(result.success).toBe(true)
  })

  it('atualiza e depois remove (soft-delete)', async () => {
    const created = await createSupply(fd({ name: 'Verniz Teste', unit: 'ML', unitCost: '0.2' }))
    expect(created.success).toBe(true)
    const item = await prisma.supply.findFirstOrThrow({ where: { name: 'Verniz Teste' } })

    const updated = await updateSupply(item.id, fd({ name: 'Verniz Teste Atualizado', unit: 'ML', unitCost: '0.25' }))
    expect(updated.success).toBe(true)

    const del = await deleteSupply(item.id)
    expect(del.success).toBe(true)
    // Supply is referenced by ProductSupplyUsage, so deleteSupply soft-deletes
    // (active: false) instead of removing the row.
    const gone = await prisma.supply.findUnique({ where: { id: item.id } })
    expect(gone).not.toBeNull()
    expect(gone?.active).toBe(false)
  })

  it('reativa um insumo removido (soft-deleted)', async () => {
    const created = await createSupply(fd({ name: 'Verniz Reativação', unit: 'ML', unitCost: '0.3' }))
    expect(created.success).toBe(true)
    const item = await prisma.supply.findFirstOrThrow({ where: { name: 'Verniz Reativação' } })

    await deleteSupply(item.id)
    const reactivated = await reactivateSupply(item.id)
    expect(reactivated.success).toBe(true)

    const restored = await prisma.supply.findUnique({ where: { id: item.id } })
    expect(restored?.active).toBe(true)
  })
})
