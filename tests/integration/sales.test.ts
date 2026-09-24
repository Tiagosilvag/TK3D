import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { createSale, createSaleBatch, getSaleProfit, removeSaleGiftUsage, removeSaleFreight } from '@/actions/sales'
import { getProductCostBreakdown, createProduct as createProductAction } from '@/actions/products'
import { getProductVariantStockOptions } from '@/lib/reports'
import { createConsignmentDeliveryBatch } from '@/actions/consignmentDeliveries'
import type { SaleCostSnapshot } from '@/lib/costing'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  // Sale references Product, which references Printer/Filament, so it must
  // be wiped before those parent tables (children before parents), matching
  // the discipline in productionRuns.test.ts. productAccessoryUsage/
  // accessory/supply added for the Sale cost snapshot tests below, which
  // give a product an accessory usage to mutate its price after a sale.
  // Brinde: SaleGiftUsage não cascadeia com Sale (FK só com Product,
  // Restrict) -- precisa ir antes de product.deleteMany() abaixo.
  await prisma.saleGiftUsage.deleteMany()
  await prisma.saleFreight.deleteMany()
  await prisma.sale.deleteMany()
  // StockConsumption (embalagem consumida por consumePackagingForSale) tem
  // FK real pra Product -- precisa ir antes do product.deleteMany() abaixo.
  // Nenhum teste deste arquivo lia isso antes dos testes de createSaleBatch.
  await prisma.stockConsumption.deleteMany()
  await prisma.consignmentSaleReport.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productSupplyUsage.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.product.deleteMany()
  // productPackagingUsage já foi cascade-deletado junto do Product acima --
  // packagingItem (a tabela de catálogo) só pode ser removida DEPOIS disso,
  // senão a FK Restrict de ProductPackagingUsage bloqueia. Criado pelos
  // testes de createSaleBatch abaixo.
  await prisma.packagingItem.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
  await prisma.accessory.deleteMany()
  await prisma.supply.deleteMany()
  // Settings é uma linha singleton compartilhada por TODO o arquivo de
  // teste -- products.test.ts's cleanup() faz settings.deleteMany() (sem
  // recriar) em algum ponto da suíte completa, o que deixa createSale
  // (via getProductCostBreakdown) sem linha pra ler se products.test.ts
  // rodar antes deste arquivo. Reforça os campos que afetam custo pro
  // valor padrão do schema, sempre -- mesma defesa já aplicada em
  // marketplacePlatforms.test.ts (inclusive contra o próprio teste deste
  // arquivo que deixa laborCostPerHour em 999 de propósito, sem restaurar).
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { laborCostPerHour: 10, defaultMarkup: 2, energyCostPerKwh: 1, failureRatePercent: 0.1, taxPercent: 0.055 },
    create: { id: 1 },
  })
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

async function createSupportRecords() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const product = await prisma.product.create({
    data: {
      name: 'Chaveirinho',
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

describe('sales actions', () => {
  it('cria uma venda direta válida', async () => {
    const { product } = await createSupportRecords()

    const result = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '2',
      unitPrice: '35.00',
      saleDate: '2026-09-01',
      buyerOrPlatform: 'Maria',
    }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(sale.channel).toBe('DIRETA')
    expect(sale.quantity).toBe(2)
    expect(sale.unitPrice.toNumber()).toBe(35)
    expect(sale.buyerOrPlatform).toBe('Maria')
  })

  it('cria uma venda de marketplace válida', async () => {
    const { product } = await createSupportRecords()

    const result = await createSale(fd({
      channel: 'MARKETPLACE',
      productId: product.id,
      quantity: '1',
      unitPrice: '42.90',
      saleDate: '2026-09-02',
      buyerOrPlatform: 'Shopee',
    }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(sale.channel).toBe('MARKETPLACE')
    expect(sale.quantity).toBe(1)
    expect(sale.unitPrice.toNumber()).toBe(42.9)
  })

  it('rejeita quantidade zero ou negativa', async () => {
    const { product } = await createSupportRecords()

    const zero = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '0',
      unitPrice: '35.00',
      saleDate: '2026-09-01',
    }))
    expect(zero.success).toBe(false)

    const negative = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '-3',
      unitPrice: '35.00',
      saleDate: '2026-09-01',
    }))
    expect(negative.success).toBe(false)

    const count = await prisma.sale.count({ where: { productId: product.id } })
    expect(count).toBe(0)
  })
})

// New feature (task-10 brief): Sale gains costSnapshot, mirroring
// ProductionRun's exactly (spec §4 pattern, Task 7). createSale computes and
// stores it ONCE at creation time from getProductCostBreakdown's
// then-current values; getSaleProfit() reads it back instead of
// recalculating live. Same guarantee already proven for ProductionRun in
// Task 7's tests: changing a price afterward must not move an
// already-recorded sale's profit.
describe('Sale cost snapshot (task-10 brief, new feature)', () => {
  async function createProductWithAccessory() {
    const printer = await prisma.printer.create({ data: { name: 'P2', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F2', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    const accessory = await prisma.accessory.create({ data: { name: 'Argola Snapshot', type: 'MOSQUETAO', currentStock: 100, avgUnitCost: 0.50 } })
    const product = await prisma.product.create({
      data: {
        name: 'Produto Com Acessório Snapshot',
        printerId: printer.id,
        filamentId: filament.id,
        weightGrams: 30,
        printTimeHours: 2,
        laborTimeHours: 0.25,
      },
    })
    await prisma.productAccessoryUsage.create({ data: { productId: product.id, accessoryId: accessory.id, quantity: 2 } })
    return { printer, filament, accessory, product }
  }

  it('createSale grava um costSnapshot com o total correto (unitCost.finalCost * quantity)', async () => {
    const { product } = await createProductWithAccessory()

    const result = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '3',
      unitPrice: '50.00',
      saleDate: '2026-09-01',
    }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(sale.costSnapshot).not.toBeNull()
    const snapshot = sale.costSnapshot as unknown as SaleCostSnapshot
    expect(snapshot.quantity).toBe(3)
    expect(snapshot.total).toBeCloseTo(snapshot.unitCost.finalCost * 3, 6)

    const profit = await getSaleProfit(sale.id)
    expect(profit.estimated).toBe(false)
    expect(profit.profit).toBeCloseTo(3 * 50 - snapshot.total, 6)
  })

  it('lucro de uma venda já registrada NÃO muda depois que o preço de um acessório ou de Settings muda (mesma garantia de ProductionRun/Task 7)', async () => {
    const { accessory, printer, product } = await createProductWithAccessory()
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })

    const result = await createSale(fd({
      channel: 'DIRETA',
      productId: product.id,
      quantity: '2',
      unitPrice: '60.00',
      saleDate: '2026-09-01',
    }))
    expect(result.success).toBe(true)
    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })

    const profitBefore = await getSaleProfit(sale.id)
    expect(profitBefore.estimated).toBe(false)

    // Change the accessory's avgUnitCost (e.g. a new, more expensive
    // AccessoryPurchase recalculated it), a Settings cost input, AND the
    // product's printer's own tariff/maintenance (melhoria "Impressoras":
    // these two moved from Settings to Printer) -- all AFTER the sale was
    // already recorded.
    await prisma.accessory.update({ where: { id: accessory.id }, data: { avgUnitCost: 99 } })
    await prisma.settings.update({ where: { id: 1 }, data: { laborCostPerHour: 999 } })
    await prisma.printer.update({ where: { id: printer.id }, data: { energyCostPerKwh: 999, maintenanceCostPerHour: 999 } })

    const profitAfter = await getSaleProfit(sale.id)
    expect(profitAfter.profit).toBeCloseTo(profitBefore.profit, 6)
    expect(profitAfter.estimated).toBe(false)

    // Sanity check: had this sale recalculated live (the old, pre-Fix
    // behavior), its profit WOULD have moved -- proving the settings/
    // accessory change above was actually capable of affecting cost.
    const liveBreakdown = await getProductCostBreakdown(product.id)
    const liveRecomputedProfit = 2 * (60 - liveBreakdown.finalCost)
    expect(liveRecomputedProfit).not.toBeCloseTo(profitBefore.profit, 1)
  })

  it('venda legada sem costSnapshot (pré-migration) cai no fallback de recálculo ao vivo, marcado como estimated', async () => {
    const { product } = await createProductWithAccessory()

    // Simulates a pre-migration row: created directly, bypassing createSale,
    // so costSnapshot stays null (exactly what old rows look like).
    const legacySale = await prisma.sale.create({
      data: { channel: 'DIRETA', productId: product.id, quantity: 1, unitPrice: 100, saleDate: new Date('2026-01-01'), batchId: randomUUID() },
    })
    expect(legacySale.costSnapshot).toBeNull()

    const profit = await getSaleProfit(legacySale.id)
    expect(profit.estimated).toBe(true)
    // Doesn't crash/lock the screen -- a real number comes back, computed
    // live via getProductCostBreakdown, matching the pre-Fix behavior for
    // exactly this legacy case.
    expect(typeof profit.profit).toBe('number')
    expect(Number.isFinite(profit.profit)).toBe(true)
  })
})

// Melhoria "Vendas por variante": Sale ganha colorComboKey (mesma convenção
// de ConsignmentDelivery.colorComboKey) -- createSale/updateSale gravam
// exatamente o que o formulário manda, sem checagem de estoque bloqueante
// no servidor (mesmo padrão de createConsignmentDeliveryBatch).
describe('Vendas por variante (Sale.colorComboKey)', () => {
  async function createTwoColorProduct() {
    const printer = await prisma.printer.create({ data: { name: 'P3', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const rosa = await prisma.filament.create({ data: { manufacturer: 'F3', material: 'PLA', colorName: 'Rosa', colorHex: '#ff69b4', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    const azul = await prisma.filament.create({ data: { manufacturer: 'F3', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    const product = await prisma.product.create({
      data: { name: 'Produto Duas Cores', category: 'Chaveiro', printerId: printer.id, filamentId: rosa.id, weightGrams: 10, printTimeHours: 0.3, laborTimeHours: 0 },
    })
    // Produzido direto via ProductionRun (produto sem componente algum --
    // "produzido" já É o estoque, sem passar por Montagem).
    await prisma.productionRun.create({
      data: { batchId: 'b1', productId: product.id, printerId: printer.id, filamentId: rosa.id, date: new Date('2026-09-01'), quantityPlanned: 45, quantitySuccess: 45, quantityFailed: 0, gramsUsed: 450, gramsWasted: 0, timeWastedHours: 0 },
    })
    await prisma.productionRun.create({
      data: { batchId: 'b2', productId: product.id, printerId: printer.id, filamentId: azul.id, date: new Date('2026-09-01'), quantityPlanned: 30, quantitySuccess: 30, quantityFailed: 0, gramsUsed: 300, gramsWasted: 0, timeWastedHours: 0 },
    })
    return { printer, rosa, azul, product }
  }

  it('createSale grava a cor escolhida (colorComboKey), e null quando o formulário não manda nenhuma', async () => {
    const { product, rosa } = await createTwoColorProduct()

    const result = await createSale(fd({
      channel: 'DIRETA', productId: product.id, quantity: '2', unitPrice: '30.00', saleDate: '2026-09-05', colorComboKey: rosa.id,
    }))
    expect(result.success).toBe(true)
    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(sale.colorComboKey).toBe(rosa.id)

    await prisma.sale.deleteMany({ where: { productId: product.id } })
    const withoutColor = await createSale(fd({ channel: 'DIRETA', productId: product.id, quantity: '1', unitPrice: '30.00', saleDate: '2026-09-05' }))
    expect(withoutColor.success).toBe(true)
    const saleNoColor = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    expect(saleNoColor.colorComboKey).toBeNull()
  })

  it('getProductVariantStockOptions desconta TANTO venda direta QUANTO entrega em consignação do mesmo pool por cor', async () => {
    const { product, rosa, azul } = await createTwoColorProduct()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Ana', defaultCommissionPercent: 0.3 } })

    // Vende 10 Rosa direto e entrega 15 Rosa em consignação -- ambos
    // consomem do MESMO pool de 45 Rosa produzidos.
    await createSale(fd({ channel: 'DIRETA', productId: product.id, quantity: '10', unitPrice: '30.00', saleDate: '2026-09-05', colorComboKey: rosa.id }))
    await createConsignmentDeliveryBatch(fd({
      partnerId: partner.id, deliveryDate: '2026-09-06', notes: '',
      itemsJson: JSON.stringify([{ productId: product.id, colorComboKey: rosa.id, quantityDelivered: 15, unitPrice: 25 }]),
    }))

    const options = await getProductVariantStockOptions()
    const option = options.find((o) => o.productId === product.id)!
    const rosaOption = option.variants.find((v) => v.key === rosa.id)!
    expect(rosaOption.available).toBe(45 - 10 - 15) // 20

    // Azul não foi tocado -- continua com os 30 inteiros.
    const azulOption = option.variants.find((v) => v.key === azul.id)!
    expect(azulOption.available).toBe(30)
  })
})

// Melhoria "Vendas: múltiplos produtos numa venda": createSaleBatch cria N
// linhas de Sale (uma por produto) numa transação só, todas compartilhando
// um batchId -- mesmo padrão de createConsignmentDeliveryBatch. Nenhuma
// lógica de custo/taxa/embalagem muda (createSaleRow reaproveita exatamente
// o que createSale já fazia por linha).
describe('createSaleBatch (Vendas: múltiplos produtos numa venda)', () => {
  async function createProductWithPackaging(name: string, printerId: string, filamentId: string, packagingQuantity: number) {
    const packagingItem = await prisma.packagingItem.create({ data: { name: `Embalagem ${name}`, currentStock: 100, avgUnitCost: 0.5 } })
    const product = await prisma.product.create({
      data: { name, category: 'Chaveiro', printerId, filamentId, weightGrams: 20, printTimeHours: 1, laborTimeHours: 0.1 },
    })
    await prisma.productPackagingUsage.create({ data: { productId: product.id, packagingItemId: packagingItem.id, quantity: packagingQuantity } })
    return { product, packagingItem }
  }

  it('cria 1 linha de Sale por item, todas com o mesmo batchId, cada uma com seu próprio costSnapshot e consumo de embalagem', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P-batch', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F-batch', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    const { product: productA, packagingItem: packagingA } = await createProductWithPackaging('Produto A', printer.id, filament.id, 1)
    const { product: productB, packagingItem: packagingB } = await createProductWithPackaging('Produto B', printer.id, filament.id, 2)

    const result = await createSaleBatch(fd({
      channel: 'DIRETA',
      saleDate: '2026-09-10',
      buyerOrPlatform: 'João',
      itemsJson: JSON.stringify([
        { productId: productA.id, quantity: 2, unitPrice: 35 },
        { productId: productB.id, quantity: 3, unitPrice: 50 },
      ]),
    }))
    expect(result.success).toBe(true)

    const sales = await prisma.sale.findMany({ orderBy: { unitPrice: 'asc' } })
    expect(sales).toHaveLength(2)
    expect(sales[0].batchId).toBe(sales[1].batchId)
    expect(sales[0].batchId).toBeTruthy()
    expect(sales.every((s) => s.buyerOrPlatform === 'João' && s.channel === 'DIRETA')).toBe(true)

    const saleA = sales.find((s) => s.productId === productA.id)!
    const saleB = sales.find((s) => s.productId === productB.id)!
    expect(saleA.quantity).toBe(2)
    expect(saleB.quantity).toBe(3)
    const snapshotA = saleA.costSnapshot as unknown as SaleCostSnapshot
    const snapshotB = saleB.costSnapshot as unknown as SaleCostSnapshot
    expect(snapshotA.total).toBeCloseTo(snapshotA.unitCost.finalCost * 2, 6)
    expect(snapshotB.total).toBeCloseTo(snapshotB.unitCost.finalCost * 3, 6)

    // Embalagem consumida por item: A usa 1/un * 2 = 2; B usa 2/un * 3 = 6.
    const updatedPackagingA = await prisma.packagingItem.findUniqueOrThrow({ where: { id: packagingA.id } })
    const updatedPackagingB = await prisma.packagingItem.findUniqueOrThrow({ where: { id: packagingB.id } })
    expect(updatedPackagingA.currentStock.toNumber()).toBe(100 - 2)
    expect(updatedPackagingB.currentStock.toNumber()).toBe(100 - 6)
  })

  it('rejeita um lote sem nenhum item, sem gravar nada', async () => {
    const result = await createSaleBatch(fd({ channel: 'DIRETA', saleDate: '2026-09-10', itemsJson: JSON.stringify([]) }))
    expect(result.success).toBe(false)
    expect(await prisma.sale.count()).toBe(0)
  })

  it('rejeita itemsJson malformado, sem gravar nada', async () => {
    const result = await createSaleBatch(fd({ channel: 'DIRETA', saleDate: '2026-09-10', itemsJson: '{not valid json' }))
    expect(result.success).toBe(false)
    expect(await prisma.sale.count()).toBe(0)
  })

  it('createSale (venda de 1 item) continua gerando seu próprio batchId -- 2 chamadas separadas nunca compartilham lote', async () => {
    const { product } = await createSupportRecords()

    await createSale(fd({ channel: 'DIRETA', productId: product.id, quantity: '1', unitPrice: '10', saleDate: '2026-09-10' }))
    await createSale(fd({ channel: 'DIRETA', productId: product.id, quantity: '1', unitPrice: '20', saleDate: '2026-09-11' }))

    const sales = await prisma.sale.findMany({ orderBy: { unitPrice: 'asc' } })
    expect(sales).toHaveLength(2)
    expect(sales[0].batchId).toBeTruthy()
    expect(sales[1].batchId).toBeTruthy()
    expect(sales[0].batchId).not.toBe(sales[1].batchId)
  })
})

// Brinde (spec "Brinde reciclado no sistema" §2): anexo opcional por LOTE
// (não por linha de Sale) -- custo congelado na criação, entra no custo
// total sem afetar o valor cobrado do cliente.
describe('Brinde anexado a uma venda (createSaleBatch + removeSaleGiftUsage)', () => {
  async function createGiftProduct(name: string, unitCost: number) {
    await createProductAction(fd({
      name,
      category: 'Chaveiro',
      isGift: 'true',
      giftMaterialsJson: JSON.stringify([{ description: 'Material', unitCost }]),
      giftEquipmentJson: '[]',
      giftAccessoriesJson: '[]',
    }))
    return prisma.product.findFirstOrThrow({ where: { name } })
  }

  it('cria 1 SaleGiftUsage com o batchId do lote e unitCost congelado', async () => {
    const { product } = await createSupportRecords()
    // resolveGiftPlaceholder precisa de impressora/filamento -- já existem
    // via createSupportRecords, reaproveitados.
    const gift = await createGiftProduct('Chaveiro Purga Reciclada', 0.93)

    const result = await createSaleBatch(fd({
      channel: 'DIRETA',
      saleDate: '2026-09-16',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 10 }]),
      giftProductId: gift.id,
      giftQuantity: '2',
    }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    const giftUsage = await prisma.saleGiftUsage.findFirstOrThrow({ where: { batchId: sale.batchId } })
    expect(giftUsage.productId).toBe(gift.id)
    expect(giftUsage.quantity).toBe(2)
    expect(giftUsage.unitCost.toNumber()).toBeCloseTo(0.93, 6)
  })

  it('sem giftProductId/giftQuantity: nenhum SaleGiftUsage é criado (comportamento padrão, sem brinde)', async () => {
    const { product } = await createSupportRecords()
    await createSaleBatch(fd({
      channel: 'DIRETA',
      saleDate: '2026-09-16',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 10 }]),
    }))
    expect(await prisma.saleGiftUsage.count()).toBe(0)
  })

  it('removeSaleGiftUsage remove o brinde sem afetar as linhas de Sale do lote', async () => {
    const { product } = await createSupportRecords()
    const gift = await createGiftProduct('Chaveiro Brinde X', 1)
    await createSaleBatch(fd({
      channel: 'DIRETA',
      saleDate: '2026-09-16',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 10 }]),
      giftProductId: gift.id,
      giftQuantity: '1',
    }))
    const giftUsage = await prisma.saleGiftUsage.findFirstOrThrow()

    const result = await removeSaleGiftUsage(giftUsage.id)
    expect(result.success).toBe(true)
    expect(await prisma.saleGiftUsage.count()).toBe(0)
    expect(await prisma.sale.count()).toBe(1)
  })

  it('@@unique([batchId]) trava em no máximo 1 brinde por venda -- 2 chamadas com o mesmo giftProductId em lotes diferentes não conflitam', async () => {
    const { product } = await createSupportRecords()
    const gift = await createGiftProduct('Chaveiro Brinde Y', 1)

    await createSaleBatch(fd({
      channel: 'DIRETA', saleDate: '2026-09-16',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 10 }]),
      giftProductId: gift.id, giftQuantity: '1',
    }))
    await createSaleBatch(fd({
      channel: 'DIRETA', saleDate: '2026-09-17',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 10 }]),
      giftProductId: gift.id, giftQuantity: '1',
    }))

    expect(await prisma.saleGiftUsage.count()).toBe(2)
  })
})

// Melhoria "Frete em Vendas": mesmo raciocínio/formato do Brinde acima --
// por LOTE (SaleFreight, batchId), nunca somado por linha de Sale (evita
// contar o mesmo frete várias vezes numa venda de vários produtos).
describe('Frete anexado a uma venda (createSaleBatch + removeSaleFreight)', () => {
  it('cria 1 SaleFreight com o batchId do lote e o valor informado', async () => {
    const { product } = await createSupportRecords()

    const result = await createSaleBatch(fd({
      channel: 'MERCADO_LIVRE',
      saleDate: '2026-09-16',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 50 }]),
      freightCost: '8.45',
    }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findFirstOrThrow({ where: { productId: product.id } })
    const freight = await prisma.saleFreight.findFirstOrThrow({ where: { batchId: sale.batchId } })
    expect(freight.amount.toNumber()).toBeCloseTo(8.45, 2)
  })

  it('sem freightCost (ou 0): nenhum SaleFreight é criado', async () => {
    const { product } = await createSupportRecords()
    await createSaleBatch(fd({
      channel: 'MERCADO_LIVRE',
      saleDate: '2026-09-16',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 50 }]),
    }))
    expect(await prisma.saleFreight.count()).toBe(0)
  })

  it('venda com 2 produtos no mesmo lote: 1 SaleFreight só (não 1 por produto)', async () => {
    const { product, printer, filament } = await createSupportRecords()
    const product2 = await prisma.product.create({
      data: { name: 'Chaveirinho 2', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 20, printTimeHours: 1, laborTimeHours: 0.1 },
    })

    const result = await createSaleBatch(fd({
      channel: 'MERCADO_LIVRE',
      saleDate: '2026-09-16',
      itemsJson: JSON.stringify([
        { productId: product.id, quantity: 1, unitPrice: 50 },
        { productId: product2.id, quantity: 1, unitPrice: 30 },
      ]),
      freightCost: '10',
    }))
    expect(result.success).toBe(true)
    expect(await prisma.sale.count()).toBe(2)
    expect(await prisma.saleFreight.count()).toBe(1)
  })

  it('removeSaleFreight remove o frete sem afetar as linhas de Sale do lote', async () => {
    const { product } = await createSupportRecords()
    await createSaleBatch(fd({
      channel: 'MERCADO_LIVRE',
      saleDate: '2026-09-16',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 50 }]),
      freightCost: '5',
    }))
    const freight = await prisma.saleFreight.findFirstOrThrow()

    const result = await removeSaleFreight(freight.id)
    expect(result.success).toBe(true)
    expect(await prisma.saleFreight.count()).toBe(0)
    expect(await prisma.sale.count()).toBe(1)
  })

  it('@@unique([batchId]) trava em no máximo 1 frete por venda -- 2 chamadas em lotes diferentes não conflitam', async () => {
    const { product } = await createSupportRecords()

    await createSaleBatch(fd({
      channel: 'MERCADO_LIVRE', saleDate: '2026-09-16',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 50 }]),
      freightCost: '5',
    }))
    await createSaleBatch(fd({
      channel: 'MERCADO_LIVRE', saleDate: '2026-09-17',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 50 }]),
      freightCost: '5',
    }))

    expect(await prisma.saleFreight.count()).toBe(2)
  })
})
