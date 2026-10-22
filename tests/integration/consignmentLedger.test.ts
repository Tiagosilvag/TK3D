import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { sellVariantUnits, returnVariantUnits } from '@/actions/consignmentMovements'
import { payPartnerCommission } from '@/actions/consignmentPayments'
import { createConsignmentDeliveryBatch } from '@/actions/consignmentDeliveries'
import { restoreDeliveryPrices } from '@/actions/consignmentMovements'
import { editPartnerLedger, restorePartnerLedger } from '@/actions/consignmentLedger'
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
  const first = await prisma.consignmentDelivery.create({ data: { batchId: 'b1', partnerId: partner.id, productId: product.id, colorComboKey: 'k1', quantityDelivered: 2, unitPrice: 20, deliveryDate: new Date('2026-09-01') } })
  const second = await prisma.consignmentDelivery.create({ data: { batchId: 'b2', partnerId: partner.id, productId: product.id, colorComboKey: 'k1', quantityDelivered: 2, unitPrice: 25, deliveryDate: new Date('2026-09-10') } })
  return { partner, product, first, second, ref: { partnerId: partner.id, productId: product.id, colorComboKey: 'k1' } }
}

const comEla = async (partnerId: string) => {
  const rows = await prisma.consignmentDelivery.findMany({ where: { partnerId }, include: { saleReports: true } })
  return rows.reduce((s, d) => s + d.quantityDelivered - d.returnedQuantity - d.saleReports.reduce((x, r) => x + r.quantitySold, 0), 0)
}

describe('editPartnerLedger', () => {
  it('recusa reduzir/excluir entrega cujos itens já foram vendidos e não muda nada', async () => {
    const { partner, ref, first, second } = await setup()
    await sellVariantUnits(ref, 3) // 2 da 1ª entrega + 1 da 2ª
    const del = await editPartnerLedger(partner.id, { type: 'delivery', id: second.id, quantity: 0 })
    expect(del.success).toBe(false)
    expect(del.error).toMatch(/GATO.*-1/)
    expect(await prisma.consignmentDelivery.count()).toBe(2)
    expect(await prisma.consignmentSaleReport.count()).toBeGreaterThan(0) // venda não some junto
    const reduce = await editPartnerLedger(partner.id, { type: 'delivery', id: first.id, quantity: 1 })
    expect(reduce.success).toBe(true) // 3 vendidos de 1+2 entregues: redistribui
    void second
  })

  it('reduzir uma entrega redistribui a venda para a linha com folga (total da variação fecha)', async () => {
    const { partner, ref, first, second } = await setup()
    await sellVariantUnits(ref, 2) // ambas na 1ª entrega
    const r = await editPartnerLedger(partner.id, { type: 'delivery', id: first.id, quantity: 1 })
    expect(r.success).toBe(true)
    const rows = await prisma.consignmentDelivery.findMany({ include: { saleReports: true }, orderBy: { deliveryDate: 'asc' } })
    expect(rows[0].saleReports.reduce((s, x) => s + x.quantitySold, 0)).toBeLessThanOrEqual(1)
    expect(rows[1].saleReports.reduce((s, x) => s + x.quantitySold, 0)).toBe(1)
    expect(await comEla(partner.id)).toBe(1) // entregue 1+2, vendido 2
    void second
  })

  it('editar comissão/preço da venda e Desfazer restaura tudo', async () => {
    const { partner, ref } = await setup()
    await sellVariantUnits(ref, 2)
    const report = await prisma.consignmentSaleReport.findFirstOrThrow()
    const edited = await editPartnerLedger(partner.id, { type: 'sale', id: report.id, commissionPercent: 0.5, unitPrice: 30 })
    expect(edited.success).toBe(true)
    let detail = await getConsignmentPartnerDetail(partner.id)
    expect(detail!.commissionOwed).toBeCloseTo(2 * 30 * 0.5, 6)
    await restorePartnerLedger(partner.id, edited.snapshot!)
    detail = await getConsignmentPartnerDetail(partner.id)
    expect(detail!.commissionOwed).toBeCloseTo(2 * 25 * 0.3, 6)
  })

  it('excluir venda e desfazer recria o registro; pagamento acima da comissão é recusado', async () => {
    const { partner, ref } = await setup()
    await sellVariantUnits(ref, 2) // comissão 2*20*.3 = 12
    await payPartnerCommission(partner.id, 12)
    const report = await prisma.consignmentSaleReport.findFirstOrThrow()
    const blocked = await editPartnerLedger(partner.id, { type: 'sale', id: report.id, quantity: 0 })
    expect(blocked.success).toBe(false) // pagamentos passariam da comissão
    expect(blocked.error).toMatch(/comissão/)
    const payment = await prisma.consignmentPartnerPayment.findFirstOrThrow()
    const removed = await editPartnerLedger(partner.id, { type: 'payment', id: payment.id, amount: 0 })
    expect(removed.success).toBe(true)
    const deleted = await editPartnerLedger(partner.id, { type: 'sale', id: report.id, quantity: 0 })
    expect(deleted.success).toBe(true)
    expect(await prisma.consignmentSaleReport.count()).toBe(0)
    await restorePartnerLedger(partner.id, deleted.snapshot!)
    expect(await prisma.consignmentSaleReport.count()).toBe(1)
  })

  it('devolução editável: não passa do que ela tem', async () => {
    const { partner, ref, first } = await setup()
    await sellVariantUnits(ref, 1)
    await returnVariantUnits(ref, 1)
    const ok = await editPartnerLedger(partner.id, { type: 'return', deliveryId: first.id, quantity: 1 })
    expect(ok.success).toBe(true)
    const tooMuch = await editPartnerLedger(partner.id, { type: 'return', deliveryId: first.id, quantity: 9 })
    expect(tooMuch.success).toBe(false)
  })

  it('entregar a mesma variação com preço novo atualiza o preço dela e dá para restaurar', async () => {
    const { partner, product, first, second } = await setup()
    const fd = new FormData()
    fd.set('partnerId', partner.id)
    fd.set('deliveryDate', '2026-10-20')
    fd.set('itemsJson', JSON.stringify([{ productId: product.id, colorComboKey: 'k1', quantityDelivered: 1, unitPrice: 30 }]))
    const result = await createConsignmentDeliveryBatch(fd)
    expect(result.success).toBe(true)
    expect(result.previousPrices).toHaveLength(2)
    const rows = await prisma.consignmentDelivery.findMany({ where: { id: { in: [first.id, second.id] } } })
    expect(rows.every((r) => r.unitPrice.toNumber() === 30)).toBe(true)
    await restoreDeliveryPrices(result.previousPrices!)
    expect((await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: first.id } })).unitPrice.toNumber()).toBe(20)
    expect((await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: second.id } })).unitPrice.toNumber()).toBe(25)
  })
})
