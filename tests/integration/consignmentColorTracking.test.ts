import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createConsignmentDelivery } from '@/actions/consignmentDeliveries'
import { createConsignmentSaleReport } from '@/actions/consignmentSaleReports'
import { addProductAccessoryColorUsage, removeProductAccessoryColorUsage } from '@/actions/products'
import { getProductVariantBreakdown, getConsignmentPartnerDetail } from '@/lib/reports'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

// Nunca apaga accessoryTypeRecord: 'MOSQUETAO' e os demais tipos vêm de uma
// migration de dados (20260908020000_accessory_types_table), fixture
// permanente do banco que outros arquivos de teste (accessories.test.ts,
// products.test.ts, sales.test.ts) também assumem presente -- apagar aqui
// quebraria qualquer teste que rodasse depois deste na mesma suíte.
async function cleanup() {
  await prisma.consignmentSaleReport.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.productAccessoryColorUsage.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.product.deleteMany()
  await prisma.accessoryPurchase.deleteMany()
  await prisma.accessory.deleteMany({ where: { name: 'Correntinha' } })
  await prisma.accessoryTypeRecord.deleteMany({ where: { name: 'Corrente' } })
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

// Melhoria "Parceiros de consignação" §5: produto simples ("peça sintética")
// com acessório cadastrado, produzido/montado em 2 cores, cada cor com um
// acessório diferente associado -- monta o cenário completo (entrega com
// cor -> venda -> getConsignmentPartnerDetail) exatamente como o fluxo real
// do app, verificado também ao vivo via Playwright durante a implementação.
async function buildTwoColorProductScenario() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filamentRosa = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Rosa', colorHex: '#ff69b4', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const filamentAzul = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Azul', colorHex: '#3b82f6', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })

  const type = await prisma.accessoryTypeRecord.create({ data: { name: 'Corrente' } })
  const accessoryDourado = await prisma.accessory.create({ data: { name: 'Correntinha', type: type.id, colorName: 'Dourado', currentStock: 100, avgUnitCost: 0.5 } })
  const accessoryPrata = await prisma.accessory.create({ data: { name: 'Correntinha', type: type.id, colorName: 'Prata', currentStock: 100, avgUnitCost: 0.5 } })

  const product = await prisma.product.create({
    data: {
      name: 'Sorvete Clicker', category: 'Chaveiro',
      printerId: printer.id, filamentId: filamentRosa.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0.1,
      accessoryUsages: { create: [{ accessoryId: accessoryDourado.id, quantity: 1 }] },
    },
  })

  await prisma.productionRun.create({ data: { productId: product.id, printerId: printer.id, filamentId: filamentRosa.id, date: new Date('2026-09-01'), quantityPlanned: 5, quantitySuccess: 5, quantityFailed: 0, gramsUsed: 50, gramsWasted: 0, timeWastedHours: 0 } })
  await prisma.productionRun.create({ data: { productId: product.id, printerId: printer.id, filamentId: filamentAzul.id, date: new Date('2026-09-01'), quantityPlanned: 5, quantitySuccess: 5, quantityFailed: 0, gramsUsed: 50, gramsWasted: 0, timeWastedHours: 0 } })

  await prisma.productAssembly.create({ data: { productId: product.id, quantity: 3, colorChoices: { [product.id]: filamentRosa.id } } })
  await prisma.productAssembly.create({ data: { productId: product.id, quantity: 2, colorChoices: { [product.id]: filamentAzul.id } } })

  return { printer, filamentRosa, filamentAzul, accessoryDourado, accessoryPrata, product }
}

describe('getProductVariantBreakdown (produto simples com montagem, 2 cores)', () => {
  it('retorna key/label/colorHex/quantity pra cada cor já montada', async () => {
    const { product, filamentRosa, filamentAzul } = await buildTwoColorProductScenario()

    const breakdown = await getProductVariantBreakdown(product.id, true)
    expect(breakdown).toHaveLength(2)

    const rosa = breakdown.find((v) => v.label.includes('Rosa'))
    expect(rosa).toEqual({ key: `${product.id}:${filamentRosa.id}`, label: 'Rosa', quantity: 3, colorHex: '#ff69b4' })

    const azul = breakdown.find((v) => v.label.includes('Azul'))
    expect(azul).toEqual({ key: `${product.id}:${filamentAzul.id}`, label: 'Azul', quantity: 2, colorHex: '#3b82f6' })
  })
})

describe('ProductAccessoryColorUsage actions', () => {
  it('adiciona e remove um acessório associado a uma cor específica, sem afetar ProductAccessoryUsage', async () => {
    const { product, filamentRosa, accessoryPrata } = await buildTwoColorProductScenario()
    const comboKey = `${product.id}:${filamentRosa.id}`

    const result = await addProductAccessoryColorUsage(fd({
      productId: product.id,
      colorComboKey: comboKey,
      accessoryId: accessoryPrata.id,
      quantity: '1',
    }))
    expect(result.success).toBe(true)

    const usage = await prisma.productAccessoryColorUsage.findFirstOrThrow({ where: { productId: product.id, colorComboKey: comboKey } })
    expect(usage.accessoryId).toBe(accessoryPrata.id)

    // A lista flat (usada por Montagem) continua com só o acessório original,
    // nunca tocada por essa mudança.
    const flatUsages = await prisma.productAccessoryUsage.findMany({ where: { productId: product.id } })
    expect(flatUsages).toHaveLength(1)

    const removed = await removeProductAccessoryColorUsage(usage.id)
    expect(removed.success).toBe(true)
    const gone = await prisma.productAccessoryColorUsage.findUnique({ where: { id: usage.id } })
    expect(gone).toBeNull()
  })
})

describe('getConsignmentPartnerDetail', () => {
  it('quebra estoque/histórico por cor e traz os chips de acessório certos pra cada cor', async () => {
    const { product, filamentRosa, filamentAzul, accessoryDourado, accessoryPrata } = await buildTwoColorProductScenario()
    const comboRosa = `${product.id}:${filamentRosa.id}`
    const comboAzul = `${product.id}:${filamentAzul.id}`

    // Rosa usa Dourado (já herdado da lista flat original), Azul usa Prata.
    await addProductAccessoryColorUsage(fd({ productId: product.id, colorComboKey: comboRosa, accessoryId: accessoryDourado.id, quantity: '1' }))
    await addProductAccessoryColorUsage(fd({ productId: product.id, colorComboKey: comboAzul, accessoryId: accessoryPrata.id, quantity: '1' }))

    const partner = await prisma.consignmentPartner.create({ data: { name: 'Maria', defaultCommissionPercent: 0.3 } })

    await createConsignmentDelivery(fd({
      partnerId: partner.id, productId: product.id, quantityDelivered: '3', unitPrice: '25',
      deliveryDate: '2026-09-01', colorComboKey: comboRosa,
    }))
    await createConsignmentDelivery(fd({
      partnerId: partner.id, productId: product.id, quantityDelivered: '2', unitPrice: '25',
      deliveryDate: '2026-09-01', colorComboKey: comboAzul,
    }))

    const rosaDelivery = await prisma.consignmentDelivery.findFirstOrThrow({ where: { partnerId: partner.id, colorComboKey: comboRosa } })
    const saleResult = await createConsignmentSaleReport(fd({
      deliveryId: rosaDelivery.id, quantitySold: '2', reportDate: '2026-09-05', commissionPercent: '0.3',
    }))
    expect(saleResult.success).toBe(true)

    const detail = await getConsignmentPartnerDetail(partner.id)
    expect(detail).not.toBeNull()
    expect(detail!.itemsWithPartner).toBe(3) // (3-2) Rosa + 2 Azul
    expect(detail!.totalSold).toBe(2)
    expect(detail!.commissionOwed).toBeCloseTo(2 * 25 * 0.3, 4) // 15

    expect(detail!.products).toHaveLength(1)
    const productBreakdown = detail!.products[0]
    expect(productBreakdown.delivered).toBe(5)
    expect(productBreakdown.sold).toBe(2)
    expect(productBreakdown.remaining).toBe(3)
    expect(productBreakdown.variants).toHaveLength(2)

    const rosaVariant = productBreakdown.variants.find((v) => v.key === comboRosa)!
    expect(rosaVariant.label).toBe('Rosa')
    expect(rosaVariant.delivered).toBe(3)
    expect(rosaVariant.sold).toBe(2)
    expect(rosaVariant.remaining).toBe(1)
    expect(rosaVariant.accessories).toEqual([{ id: accessoryDourado.id, name: 'Correntinha', colorName: 'Dourado', colorHex: null }])

    const azulVariant = productBreakdown.variants.find((v) => v.key === comboAzul)!
    expect(azulVariant.delivered).toBe(2)
    expect(azulVariant.sold).toBe(0)
    expect(azulVariant.remaining).toBe(2)
    expect(azulVariant.accessories).toEqual([{ id: accessoryPrata.id, name: 'Correntinha', colorName: 'Prata', colorHex: null }])

    // Histórico traz a cor de cada evento -- não agrupado, um por movimento.
    expect(detail!.history).toHaveLength(3) // 2 entregas + 1 venda
    const saleEvent = detail!.history.find((h) => h.type === 'venda')!
    expect(saleEvent.colorLabel).toBe('Rosa')
    expect(saleEvent.quantity).toBe(2)
  })

  it('retorna null pra parceiro inexistente', async () => {
    const detail = await getConsignmentPartnerDetail('nao-existe')
    expect(detail).toBeNull()
  })
})
