import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  createProduct,
  updateProduct,
  deleteProduct,
  getProductCostBreakdown,
  addProductSupplyUsage,
  removeProductSupplyUsage,
} from '@/actions/products'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.productSupplyUsage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.packagingItem.deleteMany()
  await prisma.accessory.deleteMany()
  await prisma.supply.deleteMany()
  await prisma.settings.deleteMany()
}

beforeAll(async () => {
  await prisma.$connect()
})
beforeEach(cleanup)
// Product has non-cascading FKs to Printer/Filament/PackagingItem/Accessory,
// which printers.test.ts/filaments.test.ts/etc. unconditionally wipe in their
// own beforeEach. Without this, a Product left behind by this file's last
// test would make those sibling suites' deleteMany() calls fail with a
// foreign key violation. Registered before the $disconnect afterAll below so
// it runs first (vitest runs same-level afterAll hooks in registration order).
afterAll(cleanup)
afterAll(async () => {
  await prisma.$disconnect()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

describe('products actions', () => {
  it('cria um produto e calcula o custo corretamente', async () => {
    await prisma.settings.create({ data: { id: 1 } })
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', diameterMm: 1.75, spoolPrice: 80, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 } })
    // Matches the costing.test.ts fixture exactly (suppliesCost: 0.3, packagingCost: 0,
    // accessoryCost: 0), with printer costing now driven by Settings defaults
    // (annualMaintenancePercent 0.10, annualUsageHours 2000): depreciation
    // 3600/10000=0.36 R$/h, maintenance 3600*0.10/2000=0.18 R$/h. suggestedPrice
    // (15.004) is reproduced here end-to-end through real DB records.
    const supply = await prisma.supply.create({ data: { name: 'Cola Teste', unit: 'ML', unitCost: 0.3 } })

    const result = await createProduct(fd({
      name: 'Chaveirinho Teste',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: '30',
      printTimeHours: '2',
      laborTimeHours: '0.25',
      finishingType: 'NENHUM',
      usesGlue: 'false',
    }))
    expect(result.success).toBe(true)

    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Chaveirinho Teste' } })
    const usageResult = await addProductSupplyUsage(fd({
      productId: product.id,
      supplyId: supply.id,
      quantity: '1',
    }))
    expect(usageResult.success).toBe(true)

    const breakdown = await getProductCostBreakdown(product.id)
    expect(breakdown.suggestedPrice).toBeCloseTo(15.004, 2)
  })

  it('rejeita produto sem impressora selecionada', async () => {
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', diameterMm: 1.75, spoolPrice: 80, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 } })
    const result = await createProduct(fd({
      name: 'Sem Impressora',
      category: 'Chaveiro',
      printerId: '',
      filamentId: filament.id,
      weightGrams: '30',
      printTimeHours: '2',
      laborTimeHours: '0.25',
      finishingType: 'NENHUM',
      usesGlue: 'false',
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza e depois remove (soft-delete)', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', diameterMm: 1.75, spoolPrice: 80, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 } })

    const created = await createProduct(fd({
      name: 'Produto Original',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: '30',
      printTimeHours: '2',
      laborTimeHours: '0.25',
      finishingType: 'NENHUM',
      usesGlue: 'false',
    }))
    expect(created.success).toBe(true)
    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Produto Original' } })

    const updated = await updateProduct(product.id, fd({
      name: 'Produto Atualizado',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: '35',
      printTimeHours: '2.5',
      laborTimeHours: '0.3',
      finishingType: 'RESINA_UV',
      usesGlue: 'true',
    }))
    expect(updated.success).toBe(true)

    const del = await deleteProduct(product.id)
    expect(del.success).toBe(true)
    const gone = await prisma.product.findUnique({ where: { id: product.id } })
    expect(gone).not.toBeNull()
    expect(gone?.active).toBe(false)
  })

  it('inclui custo de insumos, embalagem e acessório no breakdown', async () => {
    await prisma.settings.create({ data: { id: 1 } })
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', diameterMm: 1.75, spoolPrice: 80, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 } })
    const packagingItem = await prisma.packagingItem.create({ data: { name: 'Saquinho', unitCost: 0.1 } })
    const accessory = await prisma.accessory.create({ data: { name: 'Mosquetão', type: 'MOSQUETAO', unitCost: 0.3 } })
    const supply = await prisma.supply.create({ data: { name: 'Cola', unit: 'ML', unitCost: 0.05 } })

    const result = await createProduct(fd({
      name: 'Chaveiro Completo',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: '30',
      printTimeHours: '2',
      laborTimeHours: '0.25',
      packagingItemId: packagingItem.id,
      accessoryId: accessory.id,
      finishingType: 'NENHUM',
      usesGlue: 'true',
    }))
    expect(result.success).toBe(true)
    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Chaveiro Completo' } })

    const usageResult = await addProductSupplyUsage(fd({
      productId: product.id,
      supplyId: supply.id,
      quantity: '2',
    }))
    expect(usageResult.success).toBe(true)

    const breakdownWithSupply = await getProductCostBreakdown(product.id)
    expect(breakdownWithSupply.suppliesCost).toBeCloseTo(0.1, 4)
    expect(breakdownWithSupply.packagingCost).toBeCloseTo(0.1, 4)
    expect(breakdownWithSupply.accessoryCost).toBeCloseTo(0.3, 4)

    const usage = await prisma.productSupplyUsage.findFirstOrThrow({ where: { productId: product.id } })
    const removeResult = await removeProductSupplyUsage(usage.id)
    expect(removeResult.success).toBe(true)

    const breakdownWithoutSupply = await getProductCostBreakdown(product.id)
    expect(breakdownWithoutSupply.suppliesCost).toBe(0)
  })
})
