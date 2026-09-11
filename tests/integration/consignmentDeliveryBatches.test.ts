import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createConsignmentDeliveryBatch } from '@/actions/consignmentDeliveries'
import { getProductDeliveryOptions } from '@/lib/reports'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

// Nunca apaga accessoryTypeRecord -- fixture permanente, ver
// consignmentColorTracking.test.ts pro histórico completo desse cuidado.
async function cleanup() {
  await prisma.consignmentSaleReport.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productAssembly.deleteMany()
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

function fd(obj: Record<string, unknown>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, String(v))
  return f
}

async function buildSimpleProductScenario() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filamentRosa = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Rosa', colorHex: '#ff69b4', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const filamentAzul = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Azul', colorHex: '#3b82f6', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })

  const productA = await prisma.product.create({
    data: { name: 'Fidget', category: 'Chaveiro', printerId: printer.id, filamentId: filamentRosa.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0.1, suggestedPrice: 20 },
  })
  const productB = await prisma.product.create({
    data: { name: 'Picole', category: 'Chaveiro', printerId: printer.id, filamentId: filamentRosa.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0.1 },
  })
  await prisma.productionRun.create({ data: { productId: productA.id, printerId: printer.id, filamentId: filamentRosa.id, date: new Date(), quantityPlanned: 45, quantitySuccess: 45, quantityFailed: 0, gramsUsed: 450, gramsWasted: 0, timeWastedHours: 0 } })
  await prisma.productionRun.create({ data: { productId: productA.id, printerId: printer.id, filamentId: filamentAzul.id, date: new Date(), quantityPlanned: 30, quantitySuccess: 30, quantityFailed: 0, gramsUsed: 300, gramsWasted: 0, timeWastedHours: 0 } })
  await prisma.productionRun.create({ data: { productId: productB.id, printerId: printer.id, filamentId: filamentRosa.id, date: new Date(), quantityPlanned: 3, quantitySuccess: 3, quantityFailed: 0, gramsUsed: 30, gramsWasted: 0, timeWastedHours: 0 } })

  return { printer, filamentRosa, filamentAzul, productA, productB }
}

describe('createConsignmentDeliveryBatch', () => {
  it('cria N linhas de ConsignmentDelivery numa transação, compartilhando um batchId', async () => {
    const { productA, productB, filamentRosa, filamentAzul } = await buildSimpleProductScenario()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Maria', defaultCommissionPercent: 0.3 } })

    const result = await createConsignmentDeliveryBatch(fd({
      partnerId: partner.id,
      deliveryDate: '2026-09-09',
      notes: '',
      itemsJson: JSON.stringify([
        { productId: productA.id, colorComboKey: filamentRosa.id, quantityDelivered: 2, unitPrice: 25 },
        { productId: productA.id, colorComboKey: filamentAzul.id, quantityDelivered: 1, unitPrice: 25 },
        { productId: productB.id, colorComboKey: filamentRosa.id, quantityDelivered: 3, unitPrice: 20 },
      ]),
    }))
    expect(result.success).toBe(true)

    const rows = await prisma.consignmentDelivery.findMany({ where: { partnerId: partner.id } })
    expect(rows).toHaveLength(3)
    const batchIds = new Set(rows.map((r) => r.batchId))
    expect(batchIds.size).toBe(1) // todas as 3 linhas compartilham o mesmo batchId
    expect(rows.every((r) => r.deliveryDate.toISOString().startsWith('2026-09-09'))).toBe(true)
    expect(rows.reduce((sum, r) => sum + r.quantityDelivered, 0)).toBe(6)
  })

  it('rejeita um lote sem nenhum item', async () => {
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Maria', defaultCommissionPercent: 0.3 } })
    const result = await createConsignmentDeliveryBatch(fd({
      partnerId: partner.id, deliveryDate: '2026-09-09', notes: '', itemsJson: JSON.stringify([]),
    }))
    expect(result.success).toBe(false)
  })

  it('rejeita JSON de itens inválido sem lançar exceção', async () => {
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Maria', defaultCommissionPercent: 0.3 } })
    const result = await createConsignmentDeliveryBatch(fd({
      partnerId: partner.id, deliveryDate: '2026-09-09', notes: '', itemsJson: '{not json',
    }))
    expect(result.success).toBe(false)
  })
})

describe('getProductDeliveryOptions', () => {
  it('calcula "available" por variante como produzido menos já entregue, e traz o preço sugerido', async () => {
    const { productA, filamentRosa, filamentAzul } = await buildSimpleProductScenario()
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Maria', defaultCommissionPercent: 0.3 } })

    // Entrega 10 Rosa antes de consultar as opções -- disponível deve descontar isso.
    await createConsignmentDeliveryBatch(fd({
      partnerId: partner.id, deliveryDate: '2026-09-01', notes: '',
      itemsJson: JSON.stringify([{ productId: productA.id, colorComboKey: filamentRosa.id, quantityDelivered: 10, unitPrice: 20 }]),
    }))

    const options = await getProductDeliveryOptions()
    const productAOption = options.find((o) => o.productId === productA.id)!
    expect(productAOption.suggestedPrice).toBe(20)
    expect(productAOption.variants).toHaveLength(2)

    const rosa = productAOption.variants.find((v) => v.key === filamentRosa.id)!
    expect(rosa.available).toBe(35) // 45 produzido - 10 já entregue

    const azul = productAOption.variants.find((v) => v.key === filamentAzul.id)!
    expect(azul.available).toBe(30) // nada entregue ainda
  })

  it('produto sem nenhuma produção não aparece com variantes', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P2', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F2', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const product = await prisma.product.create({ data: { name: 'Nunca Produzido', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 5, printTimeHours: 0.3, laborTimeHours: 0.02 } })

    const options = await getProductDeliveryOptions()
    const option = options.find((o) => o.productId === product.id)!
    expect(option.variants).toEqual([])
  })
})
