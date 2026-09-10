import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  createProduct,
  updateProduct,
  deleteProduct,
  getProductCostBreakdown,
  getEditableFilamentOptions,
  addProductSupplyUsage,
  removeProductSupplyUsage,
  addProductAccessoryUsage,
  removeProductAccessoryUsage,
  applyProductPrice,
} from '@/actions/products'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.productSupplyUsage.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
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
    // energyCostPerKwh/maintenanceCostPerHour explícitos (melhoria
    // "Impressoras": viraram input por impressora, não vêm mais de
    // Settings) -- mesmos valores que essa impressora já tinha sob a
    // fórmula antiga (Settings default: tarifa 1.00 R$/kWh, maintenance
    // 3600*0.10/2000=0.18 R$/h), pra manter o suggestedPrice esperado
    // abaixo idêntico ao de antes da mudança.
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27, energyCostPerKwh: 1, maintenanceCostPerHour: 0.18 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    // Matches the costing.test.ts fixture exactly (suppliesCost: 0.3, packagingCost: 0,
    // accessoryCost: 0): depreciation 3600/10000=0.36 R$/h, maintenance 0.18 R$/h
    // (both from the printer above). suggestedPrice (15.004) is reproduced here
    // end-to-end through real DB records.
    const supply = await prisma.supply.create({ data: { name: 'Cola Teste', unit: 'ML', currentStock: 10, avgUnitCost: 0.3 } })

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
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
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
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })

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

  it('inclui custo de insumos, embalagem e acessórios (lista) no breakdown', async () => {
    await prisma.settings.create({ data: { id: 1 } })
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const packagingItem = await prisma.packagingItem.create({ data: { name: 'Saquinho', unitCost: 0.1 } })
    // 2 accessories (spec §2, task-5 brief: accessoryId single-FK generalized
    // into a ProductAccessoryUsage list) -- proves the new summing logic
    // through the real DB path, not just calculateProductCost in isolation.
    const accessory1 = await prisma.accessory.create({ data: { name: 'Mosquetão', type: 'MOSQUETAO', colorName: '', currentStock: 10, avgUnitCost: 0.3 } })
    const accessory2 = await prisma.accessory.create({ data: { name: 'Correntinha', type: 'CORRENTE_BOLINHA', colorName: 'Dourada', currentStock: 10, avgUnitCost: 0.2 } })
    const supply = await prisma.supply.create({ data: { name: 'Cola', unit: 'ML', currentStock: 10, avgUnitCost: 0.05 } })

    const result = await createProduct(fd({
      name: 'Chaveiro Completo',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: '30',
      printTimeHours: '2',
      laborTimeHours: '0.25',
      packagingItemId: packagingItem.id,
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

    const accessoryUsage1 = await addProductAccessoryUsage(fd({
      productId: product.id,
      accessoryId: accessory1.id,
      quantity: '1',
    }))
    expect(accessoryUsage1.success).toBe(true)
    const accessoryUsage2 = await addProductAccessoryUsage(fd({
      productId: product.id,
      accessoryId: accessory2.id,
      quantity: '2',
    }))
    expect(accessoryUsage2.success).toBe(true)

    const breakdownWithSupply = await getProductCostBreakdown(product.id)
    expect(breakdownWithSupply.suppliesCost).toBeCloseTo(0.1, 4)
    expect(breakdownWithSupply.packagingCost).toBeCloseTo(0.1, 4)
    // 1*0.3 (accessory1) + 2*0.2 (accessory2) = 0.7
    expect(breakdownWithSupply.accessoryCost).toBeCloseTo(0.7, 4)

    const usage = await prisma.productSupplyUsage.findFirstOrThrow({ where: { productId: product.id } })
    const removeResult = await removeProductSupplyUsage(usage.id)
    expect(removeResult.success).toBe(true)

    const breakdownWithoutSupply = await getProductCostBreakdown(product.id)
    expect(breakdownWithoutSupply.suppliesCost).toBe(0)
    // Removing a supply usage must not touch the untouched accessory usages.
    expect(breakdownWithoutSupply.accessoryCost).toBeCloseTo(0.7, 4)

    const accUsageRow = await prisma.productAccessoryUsage.findFirstOrThrow({ where: { productId: product.id, accessoryId: accessory1.id } })
    const removeAccResult = await removeProductAccessoryUsage(accUsageRow.id)
    expect(removeAccResult.success).toBe(true)

    const breakdownAfterRemovingOneAccessory = await getProductCostBreakdown(product.id)
    expect(breakdownAfterRemovingOneAccessory.accessoryCost).toBeCloseTo(0.4, 4)
  })

  it('rejeita quantidade não positiva ao adicionar acessório e upsert atualiza a quantidade da mesma linha', async () => {
    await prisma.settings.create({ data: { id: 1 } })
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const accessory = await prisma.accessory.create({ data: { name: 'Mosquetão', type: 'MOSQUETAO', colorName: '', currentStock: 10, avgUnitCost: 0.3 } })

    const created = await createProduct(fd({
      name: 'Chaveiro Upsert',
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
    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Chaveiro Upsert' } })

    const rejected = await addProductAccessoryUsage(fd({ productId: product.id, accessoryId: accessory.id, quantity: '0' }))
    expect(rejected.success).toBe(false)

    const first = await addProductAccessoryUsage(fd({ productId: product.id, accessoryId: accessory.id, quantity: '1' }))
    expect(first.success).toBe(true)
    const second = await addProductAccessoryUsage(fd({ productId: product.id, accessoryId: accessory.id, quantity: '5' }))
    expect(second.success).toBe(true)

    const rows = await prisma.productAccessoryUsage.findMany({ where: { productId: product.id, accessoryId: accessory.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity.toNumber()).toBe(5)
  })

  it('mantém o filamento esgotado do produto como opção selecionável (rotulado) no dropdown de edição', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const depletedFilament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const replacementFilament = await prisma.filament.create({ data: { manufacturer: 'F2', material: 'PLA', colorName: 'Branco', colorHex: '#FFFFFF', rollNumber: 2, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })

    const created = await createProduct(fd({
      name: 'Produto Com Filamento Esgotável',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: depletedFilament.id,
      weightGrams: '30',
      printTimeHours: '2',
      laborTimeHours: '0.25',
      finishingType: 'NENHUM',
      usesGlue: 'false',
    }))
    expect(created.success).toBe(true)
    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Produto Com Filamento Esgotável' } })

    // Deplete the roll to 0g, simulating stock consumed by production runs
    // after the product was created on it.
    await prisma.filament.update({ where: { id: depletedFilament.id }, data: { currentStockGrams: 0 } })

    const options = await getEditableFilamentOptions(product.id)

    // The depleted filament must still appear (clearly labeled), so a
    // <select defaultValue={product.filamentId}> always matches a real
    // <option> instead of the browser silently selecting the first option.
    const depletedOption = options.find((o) => o.id === depletedFilament.id)
    expect(depletedOption).toBeDefined()
    expect(depletedOption?.name).toMatch(/esgotado/i)

    // In-stock filaments (including a replacement roll) must also be present.
    expect(options.some((o) => o.id === replacementFilament.id)).toBe(true)
  })

  describe('applyProductPrice (task-6 brief — Simulação de preço)', () => {
    async function createBaseProduct() {
      // Fix 4 (task-10 brief): applyProductPrice now reads
      // Settings.roundingMode, so every test in this describe block needs a
      // Settings row to exist (this file's cleanup() wipes Settings
      // entirely between tests, unlike the other suites). Default
      // roundingMode (NONE) matches the pre-Fix-4 behavior exactly, so
      // tests that don't care about rounding are unaffected.
      await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
      const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
      const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
      const created = await createProduct(fd({
        name: 'Produto Preço',
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
      return prisma.product.findFirstOrThrow({ where: { name: 'Produto Preço' } })
    }

    it('grava suggestedPrice e marketplacePrice no produto', async () => {
      const product = await createBaseProduct()
      expect(product.suggestedPrice).toBeNull()
      expect(product.marketplacePrice).toBeNull()

      const result = await applyProductPrice(product.id, 18.5, 27.32)
      expect(result.success).toBe(true)

      const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
      expect(updated.suggestedPrice?.toNumber()).toBeCloseTo(18.5, 2)
      expect(updated.marketplacePrice?.toNumber()).toBeCloseTo(27.32, 2)
    })

    it('sobrescreve um preço já aplicado anteriormente', async () => {
      const product = await createBaseProduct()
      await applyProductPrice(product.id, 10, 15)
      await applyProductPrice(product.id, 20, 30)

      const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
      expect(updated.suggestedPrice?.toNumber()).toBeCloseTo(20, 2)
      expect(updated.marketplacePrice?.toNumber()).toBeCloseTo(30, 2)
    })

    it('rejeita preço negativo sem gravar nada', async () => {
      const product = await createBaseProduct()
      const result = await applyProductPrice(product.id, -5, 10)
      expect(result.success).toBe(false)

      const untouched = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
      expect(untouched.suggestedPrice).toBeNull()
      expect(untouched.marketplacePrice).toBeNull()
    })

    // Fix 4 (task-10 brief): applyRounding/Settings.roundingMode (lib/costing.ts,
    // built in Task 2) was fully implemented and unit-tested but had zero call
    // sites -- applyProductPrice persisted whatever raw value it was handed,
    // ignoring Settings.roundingMode entirely. Brief's own example: R$23,45
    // with roundingMode=R90 must be GRAVADO as R$23,90.
    it('aplica applyRounding (Settings.roundingMode) ao preço final antes de gravar (Fix 4)', async () => {
      const product = await createBaseProduct()
      await prisma.settings.upsert({ where: { id: 1 }, update: { roundingMode: 'R90' }, create: { id: 1, roundingMode: 'R90' } })

      const result = await applyProductPrice(product.id, 23.45, 41.12)
      expect(result.success).toBe(true)

      const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
      expect(updated.suggestedPrice?.toNumber()).toBeCloseTo(23.90, 2)
      expect(updated.marketplacePrice?.toNumber()).toBeCloseTo(41.90, 2)
    })

    it('com roundingMode=NONE (default), grava o preço exatamente como recebido -- sem regressão', async () => {
      const product = await createBaseProduct()
      await prisma.settings.upsert({ where: { id: 1 }, update: { roundingMode: 'NONE' }, create: { id: 1, roundingMode: 'NONE' } })

      const result = await applyProductPrice(product.id, 23.45, 41.12)
      expect(result.success).toBe(true)

      const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
      expect(updated.suggestedPrice?.toNumber()).toBeCloseTo(23.45, 2)
      expect(updated.marketplacePrice?.toNumber()).toBeCloseTo(41.12, 2)
    })
  })

  it('não duplica o filamento atual no dropdown de edição quando ele ainda está em estoque', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })

    const created = await createProduct(fd({
      name: 'Produto Com Filamento Em Estoque',
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
    const product = await prisma.product.findFirstOrThrow({ where: { name: 'Produto Com Filamento Em Estoque' } })

    const options = await getEditableFilamentOptions(product.id)
    expect(options.filter((o) => o.id === filament.id)).toHaveLength(1)
    expect(options.find((o) => o.id === filament.id)?.name).not.toMatch(/esgotado/i)
  })
})
