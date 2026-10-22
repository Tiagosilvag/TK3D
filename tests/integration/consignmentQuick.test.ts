import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { sellVariantUnits, returnVariantUnits, undoVariantMovements, setVariantUnitPrice, restoreDeliveryPrices } from '@/actions/consignmentMovements'
import { payPartnerCommission, updatePartnerPayment, deletePartnerPayment } from '@/actions/consignmentPayments'
import { getConsignmentPartnerDetail } from '@/lib/reports'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.consignmentPartnerPayment.deleteMany()
  await prisma.consignmentSaleReport.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.productPart.deleteMany()
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
  const filament = await prisma.filament.create({ data: { manufacturer: 'A', material: 'PLA', colorName: 'Preto', colorHex: '#111111', currentStockGrams: 1000, avgUnitCostPerGram: 0.08 } })
  const product = await prisma.product.create({ data: { name: 'GATO', category: 'Decoração', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 } })
  const partner = await prisma.consignmentPartner.create({ data: { name: 'ANDREZA', defaultCommissionPercent: 0.3 } })
  // 2 entregas da MESMA variação (k1), uma mais antiga que a outra.
  const first = await prisma.consignmentDelivery.create({ data: { batchId: 'b1', partnerId: partner.id, productId: product.id, colorComboKey: 'k1', quantityDelivered: 2, unitPrice: 20, deliveryDate: new Date('2026-09-01') } })
  const second = await prisma.consignmentDelivery.create({ data: { batchId: 'b2', partnerId: partner.id, productId: product.id, colorComboKey: 'k1', quantityDelivered: 2, unitPrice: 25, deliveryDate: new Date('2026-09-10') } })
  const ref = { partnerId: partner.id, productId: product.id, colorComboKey: 'k1' }
  return { partner, product, first, second, ref }
}

describe('sellVariantUnits / returnVariantUnits / undo', () => {
  it('vende pela entrega mais antiga, junta cliques seguidos e passa pra próxima quando acaba', async () => {
    const { ref, first, second } = await setup()
    const a = await sellVariantUnits(ref, 1)
    const b = await sellVariantUnits(ref, 1) // junta no mesmo registro (mesmo dia, comissão e preço)
    expect(a.success && b.success).toBe(true)
    const reports = await prisma.consignmentSaleReport.findMany({ where: { deliveryId: first.id } })
    expect(reports).toHaveLength(1)
    expect(reports[0].quantitySold).toBe(2)
    expect(reports[0].unitPrice?.toNumber()).toBe(25) // preço da linha = entrega mais recente com saldo

    const c = await sellVariantUnits(ref, 1) // 1ª entrega zerada -> 2ª
    expect(c.success).toBe(true)
    expect(await prisma.consignmentSaleReport.count({ where: { deliveryId: second.id } })).toBe(1)

    const tooMany = await sellVariantUnits(ref, 5)
    expect(tooMany.success).toBe(false)
    expect(tooMany.error).toMatch(/só tem 1/)
  })

  it('desfazer reverte exatamente o que a ação fez (criado → apaga; juntado → desconta)', async () => {
    const { ref, first } = await setup()
    await sellVariantUnits(ref, 1)
    const merged = await sellVariantUnits(ref, 1)
    expect((await undoVariantMovements(merged.movements!)).success).toBe(true)
    const report = (await prisma.consignmentSaleReport.findMany({ where: { deliveryId: first.id } }))[0]
    expect(report.quantitySold).toBe(1)
  })

  it('devolver tira do "com ela" e desfazer volta', async () => {
    const { ref, first } = await setup()
    const ret = await returnVariantUnits(ref, 3) // 2 da 1ª + 1 da 2ª
    expect(ret.success).toBe(true)
    expect((await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: first.id } })).returnedQuantity).toBe(2)
    const detail = await getConsignmentPartnerDetail(ref.partnerId)
    expect(detail!.itemsWithPartner).toBe(1)

    expect((await undoVariantMovements(ret.movements!)).success).toBe(true)
    expect((await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: first.id } })).returnedQuantity).toBe(0)
    expect((await getConsignmentPartnerDetail(ref.partnerId))!.itemsWithPartner).toBe(4)
    expect((await returnVariantUnits(ref, 9)).success).toBe(false)
  })

  it('mudar o preço vale pras próximas vendas (as já registradas guardam o preço) e restaura', async () => {
    const { ref, first, second } = await setup()
    await sellVariantUnits(ref, 1) // vende a 25 (preço da linha)
    const changed = await setVariantUnitPrice(ref, 30)
    expect(changed.success).toBe(true)
    await sellVariantUnits(ref, 1) // preço novo: não junta com a venda de 25
    const prices = (await prisma.consignmentSaleReport.findMany({ orderBy: { createdAt: 'asc' } })).map((r) => r.unitPrice?.toNumber())
    expect(prices).toEqual([25, 30])

    await restoreDeliveryPrices(changed.previous!)
    expect((await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: first.id } })).unitPrice.toNumber()).toBe(20)
    expect((await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: second.id } })).unitPrice.toNumber()).toBe(25)
  })
})

describe('pagamentos de comissão', () => {
  it('a pagar = comissão das vendas − pagamentos; recusa passar do devido; editar e excluir recalculam', async () => {
    const { ref, partner } = await setup()
    await sellVariantUnits(ref, 2) // 2 × 25 × 30% = 15
    let detail = await getConsignmentPartnerDetail(partner.id)
    expect(detail!.commissionOwed).toBeCloseTo(15, 2)
    expect(detail!.commissionDue).toBeCloseTo(15, 2)

    const partial = await payPartnerCommission(partner.id, 5)
    expect(partial.success).toBe(true)
    detail = await getConsignmentPartnerDetail(partner.id)
    expect([detail!.commissionPaid, detail!.commissionDue]).toEqual([5, 10])

    const over = await payPartnerCommission(partner.id, 10.01)
    expect(over.success).toBe(false)
    expect(over.error).toMatch(/passa do que está a pagar/)

    expect((await payPartnerCommission(partner.id, 10)).success).toBe(true)
    expect((await getConsignmentPartnerDetail(partner.id))!.commissionDue).toBe(0)

    // Editar um pagamento pra mais do que a comissão total é recusado.
    expect((await updatePartnerPayment(partial.paymentId!, 6)).success).toBe(false)
    expect((await updatePartnerPayment(partial.paymentId!, 4)).success).toBe(true)
    expect((await getConsignmentPartnerDetail(partner.id))!.commissionDue).toBe(1)

    expect((await deletePartnerPayment(partial.paymentId!)).success).toBe(true)
    expect((await getConsignmentPartnerDetail(partner.id))!.commissionDue).toBe(5)
  })
})
