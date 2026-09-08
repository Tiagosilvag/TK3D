import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProductionRun, deleteProductionRun, cancelProductionRun } from '@/actions/productionRuns'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  // Children before parents. Product cascades ProductAccessoryUsage/
  // ProductSupplyUsage; Accessory/Supply cascade their own purchase history
  // (schema onDelete: Cascade on both sides) -- so those join/history rows
  // never need an explicit deleteMany here.
  await prisma.productionRun.deleteMany()
  await prisma.product.deleteMany()
  await prisma.accessory.deleteMany()
  await prisma.supply.deleteMany()
  await prisma.packagingItem.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
}

beforeAll(async () => {
  await prisma.$connect()
})
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => {
  await prisma.$disconnect()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

// Full ficha técnica: filament + 1 accessory (qty 2/unit) + 1 supply (qty
// 3/unit, ML) + packaging -- rich enough to exercise every resource kind
// createProductionRun/cancelProductionRun must touch.
async function createSupportRecords() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const accessory = await prisma.accessory.create({ data: { name: 'Argola Dourada', type: 'OUTRO', colorName: '', currentStock: 100, avgUnitCost: 0.5 } })
  const supply = await prisma.supply.create({ data: { name: 'Cola Quente', unit: 'ML', currentStock: 50, avgUnitCost: 1.2 } })
  const packagingItem = await prisma.packagingItem.create({ data: { name: 'Saquinho', unitCost: 0.3 } })
  const product = await prisma.product.create({
    data: {
      name: 'Chaveirinho',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.25,
      packagingItemId: packagingItem.id,
      accessoryUsages: { create: [{ accessoryId: accessory.id, quantity: 2 }] },
      supplyUsages: { create: [{ supplyId: supply.id, quantity: 3 }] },
    },
  })
  return { printer, filament, accessory, supply, packagingItem, product }
}

const baseRun = {
  date: '2026-09-01',
  quantityPlanned: '10',
  quantitySuccess: '8',
  quantityFailed: '2',
  gramsUsed: '240',
  gramsWasted: '15',
  timeWastedHours: '0.5',
}

// A product with NO accessories/insumos/embalagem at all -- the minimal
// ficha técnica (filament only), exercising the empty-array/null paths in
// createProductionRun's resource loop end-to-end (not just the already
// pure-function-tested buildProductionCostSnapshot cases).
async function createMinimalSupportRecords() {
  const printer = await prisma.printer.create({ data: { name: 'P2', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F2', material: 'PLA', colorName: 'Branco', colorHex: '#FFFFFF', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const product = await prisma.product.create({
    data: {
      name: 'Peça simples',
      category: 'Chaveiro',
      printerId: printer.id,
      filamentId: filament.id,
      weightGrams: 30,
      printTimeHours: 2,
      laborTimeHours: 0.25,
    },
  })
  return { printer, filament, product }
}

describe('productionRuns actions', () => {
  it('cria um registro de produção válido', async () => {
    const { printer, filament, product } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    expect(result.success).toBe(true)

    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    expect(run.quantityPlanned).toBe(10)
    expect(run.quantitySuccess).toBe(8)
    expect(run.quantityFailed).toBe(2)
  })

  it('rejeita quando sucesso + falhas excede o planejado', async () => {
    const { printer, filament, product } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
      quantityFailed: '5',
    }))
    expect(result.success).toBe(false)

    const run = await prisma.productionRun.findFirst({ where: { productId: product.id } })
    expect(run).toBeNull()
  })

  it('remove fisicamente um registro de produção (log histórico)', async () => {
    const { printer, filament, product } = await createSupportRecords()

    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
      quantitySuccess: '10',
      quantityFailed: '0',
      gramsUsed: '0',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    const del = await deleteProductionRun(run.id)
    expect(del.success).toBe(true)

    const gone = await prisma.productionRun.findUnique({ where: { id: run.id } })
    expect(gone).toBeNull()
  })

  it('deduz gramsUsed + gramsWasted do estoque do filamento ao criar um registro válido', async () => {
    const { printer, filament, product } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    expect(result.success).toBe(true)

    const updatedFilament = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })
    expect(updatedFilament.currentStockGrams.toNumber()).toBe(1000 - (240 + 15))
  })

  // --- Correctness requirement: multi-resource consumption (spec §5.1/§5.3) ---
  it('deduz acessórios E insumos, cada um multiplicado por quantitySuccess (não quantityPlanned)', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun, // quantitySuccess: 8
    }))
    expect(result.success).toBe(true)

    const updatedAccessory = await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })
    const updatedSupply = await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })
    // 2/unit * 8 success = 16 consumed; 3/unit * 8 success = 24 consumed.
    expect(updatedAccessory.currentStock.toNumber()).toBe(100 - 16)
    expect(updatedSupply.currentStock.toNumber()).toBe(50 - 24)
  })

  it('grava costSnapshot com unitCost/total/consumedResources no formato de buildProductionCostSnapshot', async () => {
    const { printer, filament, product, accessory, supply, packagingItem } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    expect(result.success).toBe(true)

    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    const snapshot = run.costSnapshot as any
    expect(snapshot.quantityPlanned).toBe(10)
    expect(snapshot.quantitySuccess).toBe(8)
    expect(snapshot.quantityFailed).toBe(2)
    expect(typeof snapshot.unitCost.finalCost).toBe('number')
    expect(typeof snapshot.total).toBe('number')
    expect(snapshot.consumedResources.filament).toEqual({ filamentId: filament.id, gramsUsed: 240, gramsWasted: 15 })
    expect(snapshot.consumedResources.accessories).toEqual([
      { accessoryId: accessory.id, quantityPerUnit: 2, quantityConsumed: 16, unitCost: 0.5 },
    ])
    expect(snapshot.consumedResources.supplies).toEqual([
      { supplyId: supply.id, quantityPerUnit: 3, quantityConsumed: 24, unitCost: 1.2 },
    ])
    expect(snapshot.consumedResources.packaging).toEqual({
      packagingItemId: packagingItem.id,
      quantityConsumed: 8,
      unitCost: 0.3,
    })
  })

  // --- Correctness requirement: pre-transaction check across ALL resources, write NOTHING on failure ---
  it('rejeita quando o filamento é insuficiente e NÃO altera nada (nem o registro, nem nenhum estoque)', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()
    // filament.currentStockGrams is 1000g; request more than that.

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
      gramsUsed: '900',
      gramsWasted: '200',
    }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('F1 PLA Preto (necessário 1100g, disponível 1000g)')

    const run = await prisma.productionRun.findFirst({ where: { productId: product.id } })
    expect(run).toBeNull()

    const unchangedFilament = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })
    expect(unchangedFilament.currentStockGrams.toNumber()).toBe(1000)
    const unchangedAccessory = await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })
    expect(unchangedAccessory.currentStock.toNumber()).toBe(100)
    const unchangedSupply = await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })
    expect(unchangedSupply.currentStock.toNumber()).toBe(50)
  })

  it('rejeita quando só o acessório é insuficiente, nomeando-o, e não escreve nada', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()
    await prisma.accessory.update({ where: { id: accessory.id }, data: { currentStock: 10 } }) // needs 16

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    expect(result.success).toBe(false)
    expect(result.error).toBe('Estoque insuficiente: Argola Dourada (necessário 16, disponível 10)')

    expect(await prisma.productionRun.findFirst({ where: { productId: product.id } })).toBeNull()
    expect((await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()).toBe(10)
    expect((await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()).toBe(50)
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000)
  })

  // The critical multi-resource case the brief calls out explicitly.
  it('rejeita listando TODOS os recursos insuficientes simultaneamente (acessório E insumo), não só o primeiro encontrado, e não escreve nada', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()
    await prisma.accessory.update({ where: { id: accessory.id }, data: { currentStock: 10 } }) // needs 16, short 6
    await prisma.supply.update({ where: { id: supply.id }, data: { currentStock: 5 } }) // needs 24, short 19

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Estoque insuficiente: Argola Dourada (necessário 16, disponível 10); Cola Quente (necessário 24ml, disponível 5ml)',
    )

    expect(await prisma.productionRun.findFirst({ where: { productId: product.id } })).toBeNull()
    expect((await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()).toBe(10)
    expect((await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()).toBe(5)
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000)
  })

  it('rejeita quando TODOS os 3 recursos (filamento, acessório, insumo) estão insuficientes ao mesmo tempo, listando os 3', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()
    await prisma.accessory.update({ where: { id: accessory.id }, data: { currentStock: 1 } })
    await prisma.supply.update({ where: { id: supply.id }, data: { currentStock: 1 } })

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
      gramsUsed: '900',
      gramsWasted: '200',
    }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('F1 PLA Preto (necessário 1100g, disponível 1000g)')
    expect(result.error).toContain('Argola Dourada (necessário 16, disponível 1)')
    expect(result.error).toContain('Cola Quente (necessário 24ml, disponível 1ml)')

    expect(await prisma.productionRun.findFirst({ where: { productId: product.id } })).toBeNull()
  })

  it('restaura o estoque do filamento ao remover um registro de produção (corrige um lançamento errado)', async () => {
    const { printer, filament, product } = await createSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    expect(result.success).toBe(true)

    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    const del = await deleteProductionRun(run.id)
    expect(del.success).toBe(true)

    const afterDelete = await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })
    expect(afterDelete.currentStockGrams.toNumber()).toBe(1000)
  })

  it('deleteProductionRun também restaura acessórios e insumos consumidos (não só filamento)', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()

    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    const del = await deleteProductionRun(run.id)
    expect(del.success).toBe(true)

    expect((await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()).toBe(100)
    expect((await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()).toBe(50)
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000)
  })

  // --- status computation (spec §5.4) ---
  it('status = CONCLUIDA quando sucesso == planejado e sem falhas', async () => {
    const { printer, filament, product } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
      quantitySuccess: '10',
      quantityFailed: '0',
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    expect(run.status).toBe('CONCLUIDA')
  })

  it('status = PARCIAL quando sucesso < planejado e sem falhas', async () => {
    const { printer, filament, product } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
      quantitySuccess: '7',
      quantityFailed: '0',
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    expect(run.status).toBe('PARCIAL')
  })

  it('status = COM_FALHAS quando quantityFailed > 0 (mesmo que sucesso também seja menor que o planejado)', async () => {
    const { printer, filament, product } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun, // quantitySuccess 8, quantityFailed 2 -- both PARCIAL and COM_FALHAS conditions hold
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    expect(run.status).toBe('COM_FALHAS')
  })

  // --- cancelProductionRun (spec §5.5) ---
  it('cancelProductionRun seta status=CANCELADA, cancelReason, cancelDate e preserva a linha (não deleta)', async () => {
    const { printer, filament, product } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    const result = await cancelProductionRun(run.id, 'Peça quebrou no pós-processamento')
    expect(result.success).toBe(true)

    const cancelled = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(cancelled.status).toBe('CANCELADA')
    expect(cancelled.cancelReason).toBe('Peça quebrou no pós-processamento')
    expect(cancelled.cancelDate).not.toBeNull()
    // Original production facts are preserved, not erased.
    expect(cancelled.quantitySuccess).toBe(8)
    expect(cancelled.quantityFailed).toBe(2)
  })

  it('cancelProductionRun restaura filamento, acessório e insumo às quantidades pré-produção', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    // Sanity: stock was actually decremented before cancelling.
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000 - 255)

    const result = await cancelProductionRun(run.id, 'Erro de configuração')
    expect(result.success).toBe(true)

    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000)
    expect((await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()).toBe(100)
    expect((await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()).toBe(50)
  })

  // The critical "read from snapshot, not from current ficha técnica" requirement.
  it('cancelProductionRun usa as quantidades do costSnapshot, NÃO a ficha técnica atual do produto (que pode ter mudado)', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun, // consumed 16 accessory, 24 supply at creation time
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    // Ficha técnica muda DEPOIS da produção: acessório passa de 2/unit para 5/unit.
    await prisma.productAccessoryUsage.updateMany({ where: { productId: product.id, accessoryId: accessory.id }, data: { quantity: 5 } })
    // E o insumo é removido da ficha técnica do produto por completo.
    await prisma.productSupplyUsage.deleteMany({ where: { productId: product.id, supplyId: supply.id } })

    const result = await cancelProductionRun(run.id, 'Falha de impressão')
    expect(result.success).toBe(true)

    // Restauração deve usar o que foi REALMENTE consumido (16 e 24, gravados
    // no costSnapshot), não recalcular com a ficha técnica atual (que daria
    // 5*8=40 pro acessório e 0 pro insumo removido).
    expect((await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()).toBe(100)
    expect((await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()).toBe(50)
  })

  it('cancelProductionRun rejeita motivo vazio e não altera nada', async () => {
    const { printer, filament, product } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    const result = await cancelProductionRun(run.id, '   ')
    expect(result.success).toBe(false)

    const unchanged = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(unchanged.status).not.toBe('CANCELADA')
  })

  it('cancelProductionRun rejeita cancelar uma produção já cancelada (evita estornar o estoque duas vezes)', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })

    const first = await cancelProductionRun(run.id, 'Motivo 1')
    expect(first.success).toBe(true)

    const second = await cancelProductionRun(run.id, 'Motivo 2')
    expect(second.success).toBe(false)

    // Stock must reflect exactly ONE restoration, not two.
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000)
    expect((await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()).toBe(100)
    expect((await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()).toBe(50)
    // The original cancelReason from the first (successful) cancellation must survive.
    const finalRun = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(finalRun.cancelReason).toBe('Motivo 1')
  })

  it('deleteProductionRun em uma produção já CANCELADA não restaura o estoque de novo (evita dupla restauração)', async () => {
    const { printer, filament, product, accessory, supply } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    await cancelProductionRun(run.id, 'Teste')
    // Stock is fully restored at this point (1000 / 100 / 50).

    const del = await deleteProductionRun(run.id)
    expect(del.success).toBe(true)

    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000)
    expect((await prisma.accessory.findUniqueOrThrow({ where: { id: accessory.id } })).currentStock.toNumber()).toBe(100)
    expect((await prisma.supply.findUniqueOrThrow({ where: { id: supply.id } })).currentStock.toNumber()).toBe(50)
  })

  it('cancelProductionRun em um registro legado sem costSnapshot restaura só o filamento (via gramsUsed/gramsWasted do próprio registro)', async () => {
    const { printer, filament, product } = await createSupportRecords()
    // Simulates a pre-Task-7 row: created directly, bypassing the action, with
    // costSnapshot left null (as a real historical row would be after migration).
    const legacyRun = await prisma.productionRun.create({
      data: {
        productId: product.id,
        printerId: printer.id,
        filamentId: filament.id,
        date: new Date('2026-01-01'),
        quantityPlanned: 10,
        quantitySuccess: 8,
        quantityFailed: 2,
        gramsUsed: 240,
        gramsWasted: 15,
        timeWastedHours: 0.5,
      },
    })
    await prisma.filament.update({ where: { id: filament.id }, data: { currentStockGrams: { decrement: 255 } } })
    expect(legacyRun.costSnapshot).toBeNull()

    const result = await cancelProductionRun(legacyRun.id, 'Correção retroativa')
    expect(result.success).toBe(true)

    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000)
    const cancelled = await prisma.productionRun.findUniqueOrThrow({ where: { id: legacyRun.id } })
    expect(cancelled.status).toBe('CANCELADA')
  })

  it('funciona normalmente para um produto sem acessórios/insumos/embalagem (só filamento)', async () => {
    const { printer, filament, product } = await createMinimalSupportRecords()

    const result = await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      ...baseRun,
    }))
    expect(result.success).toBe(true)

    const run = await prisma.productionRun.findFirstOrThrow({ where: { productId: product.id } })
    const snapshot = run.costSnapshot as any
    expect(snapshot.consumedResources.accessories).toEqual([])
    expect(snapshot.consumedResources.supplies).toEqual([])
    expect(snapshot.consumedResources.packaging).toBeNull()
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000 - 255)

    const cancel = await cancelProductionRun(run.id, 'Teste sem acessórios')
    expect(cancel.success).toBe(true)
    expect((await prisma.filament.findUniqueOrThrow({ where: { id: filament.id } })).currentStockGrams.toNumber()).toBe(1000)
  })
})
