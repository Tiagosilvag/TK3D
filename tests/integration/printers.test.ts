import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createPrinter, updatePrinter, deletePrinter, reactivatePrinter, deletePrinterPermanently } from '@/actions/printers'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

// Product/ProductionRun reference Printer via FK, so children must be wiped
// before the parent table (matching the discipline in productionRuns.test.ts).
async function cleanup() {
  await prisma.productionRun.deleteMany()
  await prisma.productSupplyUsage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.printer.deleteMany()
}

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})
beforeEach(cleanup)

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
      energyCostPerKwh: '1',
      maintenanceCostPerHour: '0.15',
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
      energyCostPerKwh: '1',
      maintenanceCostPerHour: '0.15',
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza e depois remove', async () => {
    const created = await createPrinter(fd({
      name: 'Teste Y1', purchasePrice: '1000', depreciationHours: '5000', avgPowerConsumptionKwh: '0.2', energyCostPerKwh: '1', maintenanceCostPerHour: '0.05',
    }))
    expect(created.success).toBe(true)
    const printer = await prisma.printer.findFirstOrThrow({ where: { name: 'Teste Y1' } })

    const updated = await updatePrinter(printer.id, fd({
      name: 'Teste Y1 Atualizada', purchasePrice: '1100', depreciationHours: '5000', avgPowerConsumptionKwh: '0.2', energyCostPerKwh: '1', maintenanceCostPerHour: '0.05',
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
      name: 'Teste Z1', purchasePrice: '1000', depreciationHours: '5000', avgPowerConsumptionKwh: '0.2', energyCostPerKwh: '1', maintenanceCostPerHour: '0.05',
    }))
    expect(created.success).toBe(true)
    const printer = await prisma.printer.findFirstOrThrow({ where: { name: 'Teste Z1' } })

    await deletePrinter(printer.id)
    const reactivated = await reactivatePrinter(printer.id)
    expect(reactivated.success).toBe(true)

    const restored = await prisma.printer.findUnique({ where: { id: printer.id } })
    expect(restored?.active).toBe(true)
  })

  it('atualiza os campos de uma impressora existente ao editar', async () => {
    const created = await createPrinter(fd({
      name: 'Teste Edit1', purchasePrice: '1000', depreciationHours: '5000', avgPowerConsumptionKwh: '0.2', energyCostPerKwh: '1', maintenanceCostPerHour: '0.05',
    }))
    expect(created.success).toBe(true)
    const printer = await prisma.printer.findFirstOrThrow({ where: { name: 'Teste Edit1' } })

    const updated = await updatePrinter(printer.id, fd({
      name: 'Teste Edit1 Nova', purchasePrice: '2500', depreciationHours: '8000', avgPowerConsumptionKwh: '0.33', energyCostPerKwh: '1.2', maintenanceCostPerHour: '0.2',
    }))
    expect(updated.success).toBe(true)

    const reloaded = await prisma.printer.findUniqueOrThrow({ where: { id: printer.id } })
    expect(reloaded.name).toBe('Teste Edit1 Nova')
    expect(reloaded.purchasePrice.toNumber()).toBe(2500)
    expect(reloaded.depreciationHours.toNumber()).toBe(8000)
    expect(reloaded.avgPowerConsumptionKwh.toNumber()).toBe(0.33)
    expect(reloaded.energyCostPerKwh.toNumber()).toBe(1.2)
    expect(reloaded.maintenanceCostPerHour.toNumber()).toBe(0.2)
  })

  it('exclui permanentemente uma impressora sem vínculos', async () => {
    const created = await createPrinter(fd({
      name: 'Teste Del1', purchasePrice: '1000', depreciationHours: '5000', avgPowerConsumptionKwh: '0.2', energyCostPerKwh: '1', maintenanceCostPerHour: '0.05',
    }))
    expect(created.success).toBe(true)
    const printer = await prisma.printer.findFirstOrThrow({ where: { name: 'Teste Del1' } })

    const result = await deletePrinterPermanently(printer.id)
    expect(result.success).toBe(true)

    // Unlike deletePrinter (soft-delete), the row must actually be gone.
    const gone = await prisma.printer.findUnique({ where: { id: printer.id } })
    expect(gone).toBeNull()
  })

  it('recusa exclusão permanente de impressora vinculada a um Product e mantém a impressora no banco', async () => {
    const printer = await prisma.printer.create({
      data: { name: 'Teste Del2', purchasePrice: 1000, depreciationHours: 5000, avgPowerConsumptionKwh: 0.2 },
    })
    const filament = await prisma.filament.create({
      data: {
        manufacturer: 'F1',
        material: 'PLA',
        colorName: 'Preto',
        colorHex: '#000000',
        rollNumber: 1,
        spoolPrice: 80,
        spoolWeightKg: 1,
        initialStockGrams: 1000,
        currentStockGrams: 1000,
      },
    })
    await prisma.product.create({
      data: {
        name: 'Produto vinculado',
        category: 'Chaveiro',
        printerId: printer.id,
        filamentId: filament.id,
        weightGrams: 30,
        printTimeHours: 2,
        laborTimeHours: 0.25,
      },
    })

    const result = await deletePrinterPermanently(printer.id)
    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Não é possível excluir: esta impressora tem produtos ou produções vinculadas. Desative-a em vez disso.',
    )

    const stillThere = await prisma.printer.findUnique({ where: { id: printer.id } })
    expect(stillThere).not.toBeNull()
  })
})
