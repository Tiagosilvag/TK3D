import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createSaleFromModal, updateSaleFromModal, undoCreatedSale, getSaleModalInput, type SaleModalInput } from '@/actions/saleModal'
import { updateSaleQuantityPrice, getSaleProfit } from '@/actions/sales'
import { calculateSale } from '@/lib/saleModal'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.stockConsumption.deleteMany()
  await prisma.saleGiftUsage.deleteMany()
  await prisma.saleFreight.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.productPackagingUsage.deleteMany()
  await prisma.packagingItem.deleteMany({ where: { name: { startsWith: 'TESTE ' } } })
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
}

beforeAll(async () => { await prisma.$connect() })
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => { await prisma.$disconnect() })

async function setup() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'A', material: 'PLA', colorName: 'Preto', colorHex: '#111111', currentStockGrams: 5000, avgUnitCostPerGram: 0.08 } })
  const envelope = await prisma.packagingItem.create({ data: { name: 'TESTE ENVELOPE', currentStock: 100, avgUnitCost: 0.8 } })
  const caixa = await prisma.packagingItem.create({ data: { name: 'TESTE CAIXA', currentStock: 1, avgUnitCost: 2 } })
  const product = await prisma.product.create({
    data: { name: 'CHAVEIRO', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 0.5, laborTimeHours: 0 },
  })
  const gift = await prisma.product.create({
    data: { name: 'BRINDE', category: 'Brinde', isGift: true, printerId: printer.id, filamentId: filament.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0 },
  })
  const base: SaleModalInput = {
    channel: 'DIRETA', saleDate: '2026-10-21', buyer: 'ANA', notes: null, productId: product.id, colorComboKey: null,
    quantity: 2, unitPrice: 30, freight: 0, platformFeeTotal: null,
    packaging: [{ packagingItemId: envelope.id, quantityPerUnit: 1 }], gift: null,
  }
  return { envelope, caixa, product, gift, base }
}

const stock = async (id: string) => (await prisma.packagingItem.findUniqueOrThrow({ where: { id } })).currentStock.toNumber()

describe('createSaleFromModal', () => {
  it('grava a venda com o mesmo lucro que o modal calcula e debita a embalagem escolhida', async () => {
    const { envelope, base } = await setup()
    const result = await createSaleFromModal({ ...base, freight: 5 })
    expect(result.success).toBe(true)
    expect(await stock(envelope.id)).toBe(98)

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.saleId! } })
    const snap = sale.costSnapshot as unknown as { productionCostPerUnit: number; packaging: { total: number; lines: { unitCost: number }[] }; total: number }
    expect(snap.packaging.total).toBeCloseTo(1.6, 6) // 2 × 1 × 0,80
    // Lucro do servidor == conta pura do modal (mesmos números).
    const calc = calculateSale({ quantity: 2, unitPrice: 30, productionCostPerUnit: snap.productionCostPerUnit, packagingLines: [{ quantityPerUnit: 1, unitCost: 0.8 }], feeTotal: 0, freight: 5, gift: null })
    expect(result.profit).toBeCloseTo(calc.profit, 6)
    expect(result.revenue).toBe(60)
    // A tela de Vendas (getSaleProfit) usa snapshot.total: custo de produção + embalagem.
    const shown = await getSaleProfit(sale.id)
    expect(shown.costTotal).toBeCloseTo(snap.total, 6)
    expect(await prisma.saleFreight.count({ where: { batchId: sale.batchId } })).toBe(1)
  })

  it('taxa manual vale e continua ao editar quantidade/preço na linha; brinde entra na conta', async () => {
    const { gift, base } = await setup()
    const result = await createSaleFromModal({ ...base, channel: 'SHOPEE', platformFeeTotal: 12, gift: { productId: gift.id, quantity: 1, unitCost: 0.9 } })
    expect(result.success).toBe(true)
    const saleId = result.saleId!
    expect((await getSaleProfit(saleId)).platformFeeAmount).toBe(12)

    const edited = await updateSaleQuantityPrice(saleId, 3, 40) // edição direta na linha
    expect(edited.success).toBe(true)
    const after = await getSaleProfit(saleId)
    expect(after.platformFeeAmount).toBe(12) // taxa manual preservada
    expect(after.saleTotal).toBe(120)
    const input = await getSaleModalInput(saleId)
    expect(input!.platformFeeTotal).toBe(12)
    expect(input!.gift).toEqual({ productId: gift.id, quantity: 1, unitCost: 0.9 })
  })

  it('embalagem sem estoque é só aviso (a venda registra e o estoque fica negativo); valida entradas', async () => {
    const { caixa, base } = await setup()
    const result = await createSaleFromModal({ ...base, packaging: [{ packagingItemId: caixa.id, quantityPerUnit: 1 }] }) // precisa de 2, há 1
    expect(result.success).toBe(true)
    expect(await stock(caixa.id)).toBe(-1)

    expect((await createSaleFromModal({ ...base, quantity: 0 })).success).toBe(false)
    expect((await createSaleFromModal({ ...base, unitPrice: 0 })).success).toBe(false)
    expect((await createSaleFromModal({ ...base, packaging: [{ packagingItemId: '', quantityPerUnit: 1 }] })).success).toBe(false)
  })
})

describe('updateSaleFromModal / undoCreatedSale', () => {
  it('editar troca a embalagem (devolve a antiga, debita a nova) e refaz frete e brinde do lote', async () => {
    const { envelope, caixa, gift, base } = await setup()
    const created = await createSaleFromModal({ ...base, freight: 4 })
    const saleId = created.saleId!
    expect(await stock(envelope.id)).toBe(98)

    const result = await updateSaleFromModal(saleId, {
      ...base, quantity: 1, freight: 0,
      packaging: [{ packagingItemId: caixa.id, quantityPerUnit: 1 }],
      gift: { productId: gift.id, quantity: 2, unitCost: 1 },
    })
    expect(result.success).toBe(true)
    expect(await stock(envelope.id)).toBe(100)
    expect(await stock(caixa.id)).toBe(0)
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })
    expect(await prisma.saleFreight.count({ where: { batchId: sale.batchId } })).toBe(0)
    expect(await prisma.saleGiftUsage.count({ where: { batchId: sale.batchId } })).toBe(1)
  })

  it('desfazer apaga a venda, devolve a embalagem e remove frete e brinde', async () => {
    const { envelope, gift, base } = await setup()
    const created = await createSaleFromModal({ ...base, freight: 4, gift: { productId: gift.id, quantity: 1, unitCost: 1 } })
    expect(await stock(envelope.id)).toBe(98)
    expect((await undoCreatedSale(created.saleId!)).success).toBe(true)
    expect(await stock(envelope.id)).toBe(100)
    expect(await prisma.sale.count()).toBe(0)
    expect(await prisma.saleFreight.count()).toBe(0)
    expect(await prisma.saleGiftUsage.count()).toBe(0)
    expect((await undoCreatedSale(created.saleId!)).success).toBe(false)
  })

  it('getSaleModalInput(latest) devolve a última venda no formato do modal (Repetir)', async () => {
    const { base } = await setup()
    await createSaleFromModal({ ...base, buyer: 'PRIMEIRA' })
    await createSaleFromModal({ ...base, buyer: 'ULTIMA', quantity: 3 })
    const latest = await getSaleModalInput('latest')
    expect([latest?.buyer, latest?.quantity, latest?.packaging.length]).toEqual(['ULTIMA', 3, 1])
  })

  it('Mercado Livre: Premium usa a 2ª tabela de faixas e a escolha sobrevive à edição', async () => {
    const { base } = await setup()
    const ml = await prisma.marketplacePlatform.upsert({
      where: { platform: 'MERCADO_LIVRE' },
      update: {},
      create: { platform: 'MERCADO_LIVRE', feePercent: 0.1, feeFixed: 0, avgFreight: 0 },
    })
    const prev = { feePercent: ml.feePercent, feeFixed: ml.feeFixed, feeTiers: ml.feeTiers, feeTiersPremium: ml.feeTiersPremium }
    await prisma.marketplacePlatform.update({
      where: { id: ml.id },
      data: { feePercent: 0.1, feeFixed: 0, feeTiers: [{ maxPrice: null, feePercent: 0.1, feeFixed: 0 }], feeTiersPremium: [{ maxPrice: null, feePercent: 0.2, feeFixed: 0 }] },
    })
    try {
      const classico = await createSaleFromModal({ ...base, channel: 'MERCADO_LIVRE', listingType: 'CLASSICO' })
      const premium = await createSaleFromModal({ ...base, channel: 'MERCADO_LIVRE', listingType: 'PREMIUM' })
      expect((await getSaleProfit(classico.saleId!)).platformFeeAmount).toBeCloseTo(6, 6) // 10% de 60
      expect((await getSaleProfit(premium.saleId!)).platformFeeAmount).toBeCloseTo(12, 6) // 20% de 60
      expect((await getSaleModalInput(premium.saleId!))?.listingType).toBe('PREMIUM')
    } finally {
      await prisma.marketplacePlatform.update({
        where: { id: ml.id },
        data: { feePercent: prev.feePercent, feeFixed: prev.feeFixed, feeTiers: prev.feeTiers ?? undefined, feeTiersPremium: prev.feeTiersPremium ?? undefined },
      })
    }
  })
})
