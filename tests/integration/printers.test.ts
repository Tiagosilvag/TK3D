import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createPrinter, updatePrinter, deletePrinter, reactivatePrinter } from '@/actions/printers'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await prisma.printer.deleteMany()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('printers actions', () => {
  it('cria uma impressora válida', async () => {
    const result = await createPrinter(fd({
      name: 'Teste X1',
      purchasePrice: '3000',
      depreciationHours: '10000',
      avgPowerConsumptionKwh: '0.15',
    }))
    expect(result.success).toBe(true)
    const printer = await prisma.printer.findFirst({ where: { name: 'Teste X1' } })
    expect(printer).not.toBeNull()
  })

  it('rejeita nome vazio', async () => {
    const result = await createPrinter(fd({
      name: '',
      purchasePrice: '3000',
      depreciationHours: '10000',
      avgPowerConsumptionKwh: '0.15',
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza e depois remove', async () => {
    const created = await createPrinter(fd({
      name: 'Teste Y1', purchasePrice: '1000', depreciationHours: '5000', avgPowerConsumptionKwh: '0.2',
    }))
    expect(created.success).toBe(true)
    const printer = await prisma.printer.findFirstOrThrow({ where: { name: 'Teste Y1' } })

    const updated = await updatePrinter(printer.id, fd({
      name: 'Teste Y1 Atualizada', purchasePrice: '1100', depreciationHours: '5000', avgPowerConsumptionKwh: '0.2',
    }))
    expect(updated.success).toBe(true)

    const del = await deletePrinter(printer.id)
    expect(del.success).toBe(true)
    // deletePrinter is a soft-delete (active: false), not a physical row removal,
    // because Product/ProductionRun reference Printer — the row must survive.
    const gone = await prisma.printer.findUnique({ where: { id: printer.id } })
    expect(gone).not.toBeNull()
    expect(gone?.active).toBe(false)
  })

  it('reativa uma impressora removida (soft-deleted)', async () => {
    const created = await createPrinter(fd({
      name: 'Teste Z1', purchasePrice: '1000', depreciationHours: '5000', avgPowerConsumptionKwh: '0.2',
    }))
    expect(created.success).toBe(true)
    const printer = await prisma.printer.findFirstOrThrow({ where: { name: 'Teste Z1' } })

    await deletePrinter(printer.id)
    const reactivated = await reactivatePrinter(printer.id)
    expect(reactivated.success).toBe(true)

    const restored = await prisma.printer.findUnique({ where: { id: printer.id } })
    expect(restored?.active).toBe(true)
  })
})
