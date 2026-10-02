import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { confirmInboxOrder, ignoreInboxOrder } from '@/actions/mercadoLivreOrders'
import { createProductionRun } from '@/actions/productionRuns'

// Não roda neste sandbox (sem banco de teste vivo) -- documenta o
// comportamento esperado de actions/mercadoLivreOrders.ts, mesma
// convenção de tests/integration/orderReservations.test.ts (TEST_DATABASE_URL).
const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.marketplaceOrderInbox.deleteMany()
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productPartFilament.deleteMany()
  await prisma.productPart.deleteMany()
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
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const product = await prisma.product.create({
    data: { name: 'Chaveiro', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 },
  })
  return { printer, filament, product }
}

describe('confirmInboxOrder', () => {
  it('cria Order+OrderItem e marca o inbox como CONFIRMADO', async () => {
    const { product } = await createSupportRecords()
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '1',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB1', title: 'Chaveiro', sku: null, quantity: 1, unitPrice: 50 }],
      },
    })

    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB1', productId: product.id, colorComboKey: null }])

    expect(result.success).toBe(true)
    const updatedInbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updatedInbox.status).toBe('CONFIRMADO')
    expect(updatedInbox.confirmedOrderId).not.toBeNull()
  })

  it('rejeita confirmar um inbox que já não está PENDENTE', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '2', totalAmount: 50, items: [], status: 'IGNORADO' },
    })
    const result = await confirmInboxOrder(inbox.id, [])
    expect(result.success).toBe(false)
  })

  it('rejeita quando faltou mapear o produto de algum item', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '4',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB4', title: 'Chaveiro', sku: null, quantity: 1, unitPrice: 50 }],
      },
    })
    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB4', productId: '', colorComboKey: null }])
    expect(result.success).toBe(false)
    const updatedInbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updatedInbox.status).toBe('PENDENTE')
  })

  // Defeito real do brief corrigido na implementação: sem a chamada a
  // reconcileOrderReservations, um OrderItem criado por esta action nunca
  // teria reservedQuantity atualizado, mesmo com peça pronta em estoque
  // (CLAUDE.md "estoque derivado, não contador redundante" -- o campo
  // NUNCA é escrito à mão, só recalculado). Este teste prova o efeito
  // observável: produzir a peça ANTES de confirmar o pedido do ML, e
  // conferir que o item nasce com a peça já reservada (PRONTO_RESERVADO),
  // não com reservedQuantity preso em 0.
  it('reconcilia a reserva do item criado -- reservedQuantity reflete o estoque disponível no momento da confirmação', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: filament.id,
      date: '2026-09-01',
      quantityPlanned: '5',
      quantitySuccess: '5',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))

    const inbox = await prisma.marketplaceOrderInbox.create({
      data: {
        platform: 'MERCADO_LIVRE',
        externalOrderId: '5',
        totalAmount: 50,
        items: [{ externalItemId: 'MLB5', title: 'Chaveiro', sku: null, quantity: 2, unitPrice: 25 }],
      },
    })

    const result = await confirmInboxOrder(inbox.id, [{ externalItemId: 'MLB5', productId: product.id, colorComboKey: null }])
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.reservedQuantity).toBe(2)
    expect(item.status).toBe('PRONTO_RESERVADO')
  })
})

describe('ignoreInboxOrder', () => {
  it('marca como IGNORADO sem criar Order', async () => {
    const inbox = await prisma.marketplaceOrderInbox.create({
      data: { platform: 'MERCADO_LIVRE', externalOrderId: '3', totalAmount: 50, items: [] },
    })
    await ignoreInboxOrder(inbox.id)
    const updated = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inbox.id } })
    expect(updated.status).toBe('IGNORADO')
    expect(await prisma.order.count()).toBe(0)
  })
})
