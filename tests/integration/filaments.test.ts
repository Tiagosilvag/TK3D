import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createFilament, deleteFilament } from '@/actions/filaments'

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
  spoolWeightKg: '1',
  spoolPrice: '80',
}

describe('filaments actions', () => {
  it('cria um filamento válido com estoque inicial = estoque atual = peso em gramas e rollNumber 1', async () => {
    const result = await createFilament(fd(validInput))
    expect(result.success).toBe(true)

    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste 3Dmax' } })
    expect(filament.rollNumber).toBe(1)
    expect(filament.initialStockGrams.toNumber()).toBe(1000)
    expect(filament.currentStockGrams.toNumber()).toBe(1000)
    expect(filament.material).toBe('PLA')
    expect(filament.colorName).toBe('Vermelho')
    expect(filament.colorHex).toBe('#ff0000')
  })

  it('incrementa rollNumber para um novo rolo do mesmo fabricante+material+cor', async () => {
    await createFilament(fd(validInput))
    const second = await createFilament(fd({ ...validInput, spoolPrice: '85' }))
    expect(second.success).toBe(true)

    const rolls = await prisma.filament.findMany({
      where: { manufacturer: 'Teste 3Dmax', material: 'PLA', colorName: 'Vermelho' },
      orderBy: { rollNumber: 'asc' },
    })
    expect(rolls).toHaveLength(2)
    expect(rolls[0].rollNumber).toBe(1)
    expect(rolls[1].rollNumber).toBe(2)
  })

  it('reinicia rollNumber em 1 para uma cor diferente do mesmo fabricante+material', async () => {
    await createFilament(fd(validInput))
    const result = await createFilament(fd({ ...validInput, colorName: 'Azul', colorHex: '#0000ff' }))
    expect(result.success).toBe(true)

    const blue = await prisma.filament.findFirstOrThrow({ where: { colorName: 'Azul' } })
    expect(blue.rollNumber).toBe(1)
  })

  it('rejeita fabricante vazio', async () => {
    const result = await createFilament(fd({ ...validInput, manufacturer: '' }))
    expect(result.success).toBe(false)
  })

  it('rejeita cor hexadecimal inválida', async () => {
    const result = await createFilament(fd({ ...validInput, colorHex: 'vermelho' }))
    expect(result.success).toBe(false)
  })

  it('remove um filamento (exclusão física)', async () => {
    await createFilament(fd(validInput))
    const filament = await prisma.filament.findFirstOrThrow({ where: { manufacturer: 'Teste 3Dmax' } })

    const del = await deleteFilament(filament.id)
    expect(del.success).toBe(true)

    const gone = await prisma.filament.findUnique({ where: { id: filament.id } })
    expect(gone).toBeNull()
  })
})
