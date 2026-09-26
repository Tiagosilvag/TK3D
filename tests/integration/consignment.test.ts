import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  createConsignmentPartner,
  updateConsignmentPartner,
  deleteConsignmentPartner,
} from '@/actions/consignmentPartners'
import {
  createConsignmentDelivery,
  deleteConsignmentDelivery,
  updateConsignmentDeliveryQuantity,
  returnConsignmentDeliveryStock,
} from '@/actions/consignmentDeliveries'
import {
  createConsignmentSaleReport,
  updateConsignmentSaleReport,
  getPartnerStock,
} from '@/actions/consignmentSaleReports'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  // Children before parents: ConsignmentSaleReport -> ConsignmentDelivery ->
  // ConsignmentPartner/Product -> Printer/Filament, matching the FK-ordering
  // discipline from productionRuns.test.ts / products.test.ts.
  await prisma.consignmentSaleReport.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.productSupplyUsage.deleteMany()
  await prisma.product.deleteMany()
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

describe('consignmentPartners actions', () => {
  it('cria, atualiza e remove (soft-delete) um parceiro', async () => {
    const created = await createConsignmentPartner(fd({
      name: 'Loja Parceira',
      defaultCommissionPercent: '0.3',
    }))
    expect(created.success).toBe(true)
    const partner = await prisma.consignmentPartner.findFirstOrThrow({ where: { name: 'Loja Parceira' } })

    const updated = await updateConsignmentPartner(partner.id, fd({
      name: 'Loja Parceira Atualizada',
      defaultCommissionPercent: '0.4',
    }))
    expect(updated.success).toBe(true)

    const del = await deleteConsignmentPartner(partner.id)
    expect(del.success).toBe(true)
    const gone = await prisma.consignmentPartner.findUnique({ where: { id: partner.id } })
    expect(gone).not.toBeNull()
    expect(gone?.active).toBe(false)
  })
})

describe('consignmentDeliveries actions', () => {
  it('remove uma entrega e seus relatórios de venda em cascata', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })

    const created = await createConsignmentDelivery(fd({
      partnerId: partner.id,
      productId: product.id,
      quantityDelivered: '10',
      unitPrice: '25',
      deliveryDate: '2026-09-01',
    }))
    expect(created.success).toBe(true)
    const delivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id } })

    const saleResult = await createConsignmentSaleReport(fd({
      deliveryId: delivery.id,
      quantitySold: '3',
      reportDate: '2026-09-05',
      commissionPercent: '0.3',
    }))
    expect(saleResult.success).toBe(true)

    const removed = await deleteConsignmentDelivery(delivery.id)
    expect(removed.success).toBe(true)
    const goneDelivery = await prisma.consignmentDelivery.findUnique({ where: { id: delivery.id } })
    expect(goneDelivery).toBeNull()
    const goneReports = await prisma.consignmentSaleReport.findMany({ where: { deliveryId: delivery.id } })
    expect(goneReports).toHaveLength(0)
  })

  it('remove fisicamente uma entrega sem relatórios de venda', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })

    await createConsignmentDelivery(fd({
      partnerId: partner.id,
      productId: product.id,
      quantityDelivered: '10',
      unitPrice: '25',
      deliveryDate: '2026-09-01',
    }))
    const delivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id } })

    const del = await deleteConsignmentDelivery(delivery.id)
    expect(del.success).toBe(true)
    const gone = await prisma.consignmentDelivery.findUnique({ where: { id: delivery.id } })
    expect(gone).toBeNull()
  })

  it('ajusta a quantidade entregue, recusando um valor abaixo do já vendido', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })

    await createConsignmentDelivery(fd({
      partnerId: partner.id,
      productId: product.id,
      quantityDelivered: '10',
      unitPrice: '25',
      deliveryDate: '2026-09-01',
    }))
    const delivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id } })

    await createConsignmentSaleReport(fd({
      deliveryId: delivery.id,
      quantitySold: '3',
      reportDate: '2026-09-05',
      commissionPercent: '0.3',
    }))

    const tooLow = await updateConsignmentDeliveryQuantity(delivery.id, fd({ quantityDelivered: '2' }))
    expect(tooLow.success).toBe(false)

    const ok = await updateConsignmentDeliveryQuantity(delivery.id, fd({ quantityDelivered: '6' }))
    expect(ok.success).toBe(true)
    const updated = await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
    expect(updated.quantityDelivered).toBe(6)
  })

  // Pedido "caso eu queira pegar alguma peça que esteja com o parceiro eu
  // consigo também, voltando pro meu estoque": returnConsignmentDeliveryStock
  // decrementa quantityDelivered -- como "meu estoque" é sempre derivado
  // (produzido - entregue), esse decrement sozinho já basta pra peça
  // reaparecer no próprio estoque, sem contador redundante pra sincronizar.
  it('devolve peças ao próprio estoque, recusando devolver mais do que está com o parceiro', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })

    await createConsignmentDelivery(fd({
      partnerId: partner.id,
      productId: product.id,
      quantityDelivered: '10',
      unitPrice: '25',
      deliveryDate: '2026-09-01',
    }))
    const delivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id } })

    await createConsignmentSaleReport(fd({
      deliveryId: delivery.id,
      quantitySold: '3',
      reportDate: '2026-09-05',
      commissionPercent: '0.3',
    }))
    // 10 entregues - 3 vendidos = 7 com o parceiro (saldo devolvível).

    const tooMany = await returnConsignmentDeliveryStock(delivery.id, fd({ quantityReturned: '8' }))
    expect(tooMany.success).toBe(false)
    expect(tooMany.error).toBe('Não é possível devolver mais do que está com o parceiro (7)')

    const ok = await returnConsignmentDeliveryStock(delivery.id, fd({ quantityReturned: '4' }))
    expect(ok.success).toBe(true)
    const updated = await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
    expect(updated.quantityDelivered).toBe(6) // 10 - 4 devolvidas

    // Devolver exatamente o restante do saldo (3) deve funcionar também.
    const rest = await returnConsignmentDeliveryStock(delivery.id, fd({ quantityReturned: '3' }))
    expect(rest.success).toBe(true)
    const finalDelivery = await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
    expect(finalDelivery.quantityDelivered).toBe(3) // igual ao já vendido -- saldo zerado
  })
})

describe('consignmentSaleReports actions', () => {
  it('cria um relatório de venda válido e calcula o saldo restante via getPartnerStock', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })
    await createConsignmentDelivery(fd({
      partnerId: partner.id,
      productId: product.id,
      quantityDelivered: '10',
      unitPrice: '25',
      deliveryDate: '2026-09-01',
    }))
    const delivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id } })

    const result = await createConsignmentSaleReport(fd({
      deliveryId: delivery.id,
      quantitySold: '4',
      reportDate: '2026-09-05',
      commissionPercent: '0.3',
    }))
    expect(result.success).toBe(true)

    const stock = await getPartnerStock(partner.id)
    expect(stock).toEqual([
      {
        productId: product.id,
        productName: product.name,
        delivered: 10,
        sold: 4,
        remaining: 6,
      },
    ])
  })

  it('rejeita relatório de venda que excede o saldo restante da entrega', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })
    await createConsignmentDelivery(fd({
      partnerId: partner.id,
      productId: product.id,
      quantityDelivered: '10',
      unitPrice: '25',
      deliveryDate: '2026-09-01',
    }))
    const delivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id } })

    // First report sells 7 of 10, leaving a remaining balance of 3.
    const first = await createConsignmentSaleReport(fd({
      deliveryId: delivery.id,
      quantitySold: '7',
      reportDate: '2026-09-03',
      commissionPercent: '0.3',
    }))
    expect(first.success).toBe(true)

    // Second report tries to sell 4, but only 3 remain -> must be rejected.
    const second = await createConsignmentSaleReport(fd({
      deliveryId: delivery.id,
      quantitySold: '4',
      reportDate: '2026-09-06',
      commissionPercent: '0.3',
    }))
    expect(second.success).toBe(false)
    expect(second.error).toBe('Quantidade excede o saldo disponível (3)')

    const reports = await prisma.consignmentSaleReport.findMany({ where: { deliveryId: delivery.id } })
    expect(reports).toHaveLength(1)
  })

  // Melhoria "editar tudo no consignado": relatório de venda já registrado
  // vira editável (quantidade/preço/comissão/data) em vez de só apagar-e-
  // recriar -- a checagem de saldo exclui a PRÓPRIA quantidade da soma de
  // "já vendido" (senão ela contaria contra si mesma).
  it('edita um relatório de venda existente, recalculando o saldo sem contar a própria quantidade', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })
    await createConsignmentDelivery(fd({
      partnerId: partner.id,
      productId: product.id,
      quantityDelivered: '10',
      unitPrice: '25',
      deliveryDate: '2026-09-01',
    }))
    const delivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id } })

    await createConsignmentSaleReport(fd({
      deliveryId: delivery.id,
      quantitySold: '4',
      reportDate: '2026-09-05',
      commissionPercent: '0.3',
    }))
    const report = await prisma.consignmentSaleReport.findFirstOrThrow({ where: { deliveryId: delivery.id } })

    // Aumentar pra 9 (dentro do saldo de 10, já que a própria quantidade não
    // conta contra si mesma) deve funcionar.
    const ok = await updateConsignmentSaleReport(report.id, fd({
      deliveryId: delivery.id,
      quantitySold: '9',
      reportDate: '2026-09-06',
      commissionPercent: '0.25',
      unitPrice: '30',
    }))
    expect(ok.success).toBe(true)
    const updated = await prisma.consignmentSaleReport.findUniqueOrThrow({ where: { id: report.id } })
    expect(updated.quantitySold).toBe(9)
    expect(updated.commissionPercent.toNumber()).toBeCloseTo(0.25)
    expect(updated.unitPrice?.toNumber()).toBeCloseTo(30)

    // Passar de 10 (saldo total da entrega) deve ser recusado.
    const tooMany = await updateConsignmentSaleReport(report.id, fd({
      deliveryId: delivery.id,
      quantitySold: '11',
      reportDate: '2026-09-06',
      commissionPercent: '0.25',
    }))
    expect(tooMany.success).toBe(false)
    expect(tooMany.error).toBe('Quantidade excede o saldo disponível (10)')
  })

  it('edição que reduz a quantidade vendida devolve a diferença pro saldo com o parceiro', async () => {
    const { product } = await createSupportRecords()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Loja', defaultCommissionPercent: 0.3 } })
    await createConsignmentDelivery(fd({
      partnerId: partner.id,
      productId: product.id,
      quantityDelivered: '10',
      unitPrice: '25',
      deliveryDate: '2026-09-01',
    }))
    const delivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id } })

    await createConsignmentSaleReport(fd({
      deliveryId: delivery.id,
      quantitySold: '7',
      reportDate: '2026-09-05',
      commissionPercent: '0.3',
    }))
    const report = await prisma.consignmentSaleReport.findFirstOrThrow({ where: { deliveryId: delivery.id } })

    const result = await updateConsignmentSaleReport(report.id, fd({
      deliveryId: delivery.id,
      quantitySold: '2',
      reportDate: '2026-09-05',
      commissionPercent: '0.3',
    }))
    expect(result.success).toBe(true)

    const stock = await getPartnerStock(partner.id)
    expect(stock[0]).toMatchObject({ delivered: 10, sold: 2, remaining: 8 })
  })
})
