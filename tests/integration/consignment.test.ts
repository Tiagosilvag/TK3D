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
} from '@/actions/consignmentDeliveries'
import {
  createConsignmentSaleReport,
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
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, maintenanceCost: 1000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', diameterMm: 1.75, spoolPrice: 80, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 } })
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
  it('cria uma entrega e bloqueia delete físico se houver relatórios de venda', async () => {
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

    const blocked = await deleteConsignmentDelivery(delivery.id)
    expect(blocked.success).toBe(false)
    const stillThere = await prisma.consignmentDelivery.findUnique({ where: { id: delivery.id } })
    expect(stillThere).not.toBeNull()
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
})
