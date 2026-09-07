import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createFilament, updateFilament, deleteFilament, reactivateFilament } from '@/actions/filaments'

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

describe('filaments actions', () => {
  it('cria um filamento válido', async () => {
    const result = await createFilament(fd({
      manufacturer: 'Teste PLA',
      diameterMm: '1.75',
      spoolPrice: '80',
      spoolWeightKg: '1',
      densityGCm3: '1.24',
      nozzleTempC: '200',
      bedTempC: '60',
    }))
    expect(result.success).toBe(true)
    const filament = await prisma.filament.findFirst({ where: { manufacturer: 'Teste PLA' } })
    expect(filament).not.toBeNull()
  })

  it('rejeita fabricante vazio', async () => {
    const result = await createFilament(fd({
      manufacturer: '',
      diameterMm: '1.75',
      spoolPrice: '80',
      spoolWeightKg: '1',
      densityGCm3: '1.24',
      nozzleTempC: '200',
      bedTempC: '60',
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza e depois remove (soft-delete)', async () => {
    const created = await createFilament(fd({
      manufacturer: 'Teste ABS', diameterMm: '1.75', spoolPrice: '90', spoolWeightKg: '1', densityGCm3: '1.04', nozzleTempC: '230', bedTempC: '90',
    }))
    expect(created.success).toBe(true)
    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste ABS' } })

    const updated = await updateFilament(filament.id, fd({
      manufacturer: 'Teste ABS Atualizado', diameterMm: '1.75', spoolPrice: '95', spoolWeightKg: '1', densityGCm3: '1.04', nozzleTempC: '230', bedTempC: '90',
    }))
    expect(updated.success).toBe(true)

    const del = await deleteFilament(filament.id)
    expect(del.success).toBe(true)
    // Filament is referenced by Product/ProductionRun, so deleteFilament soft-deletes
    // (active: false) instead of removing the row.
    const gone = await prisma.filament.findUnique({ where: { id: filament.id } })
    expect(gone).not.toBeNull()
    expect(gone?.active).toBe(false)
  })

  it('reativa um filamento removido (soft-deleted)', async () => {
    const created = await createFilament(fd({
      manufacturer: 'Teste PETG', diameterMm: '1.75', spoolPrice: '100', spoolWeightKg: '1', densityGCm3: '1.27', nozzleTempC: '240', bedTempC: '80',
    }))
    expect(created.success).toBe(true)
    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste PETG' } })

    await deleteFilament(filament.id)
    const reactivated = await reactivateFilament(filament.id)
    expect(reactivated.success).toBe(true)

    const restored = await prisma.filament.findUnique({ where: { id: filament.id } })
    expect(restored?.active).toBe(true)
  })
})
