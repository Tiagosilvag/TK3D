import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, updateOrderDraft, getOrderEditHistory, updateOrderItemStatus, updateDeliveredItemPrice } from '@/actions/orders'
import { createProductionRun } from '@/actions/productionRuns'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderEditLog.deleteMany()
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  // updateOrderItemStatus(ENTREGUE) cria uma Sale/ConsignmentDelivery de
  // verdade -- precisa sumir antes do Product (FKs correspondentes), mesmo
  // motivo de orderReservations.test.ts.
  await prisma.sale.deleteMany()
  await prisma.consignmentDelivery.deleteMany()
  await prisma.consignmentPartner.deleteMany()
  await prisma.productionRun.deleteMany()
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
    data: { name: 'Peça simples', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 30, printTimeHours: 2, laborTimeHours: 0.25 },
  })
  return { printer, filament, product }
}

async function produce(productId: string, printerId: string, filamentId: string, quantitySuccess: string) {
  return createProductionRun(fd({
    productId,
    printerId,
    filamentId,
    date: '2026-09-01',
    quantityPlanned: quantitySuccess,
    quantitySuccess,
    quantityFailed: '0',
    gramsUsed: '30',
    gramsWasted: '0',
    timeWastedHours: '0',
  }))
}

// Bug "item errado devolvido quando o mesmo produto já tem outro pedido":
// findFirstOrThrow({ where: { productId } }) sem orderBy pode devolver
// QUALQUER linha existente pra esse produto (ex.: a de um pedido criado
// numa chamada anterior deste mesmo teste) -- busca pelo Order mais
// recente (createdAt desc) garante que é SEMPRE o item do pedido que
// acabou de ser criado por esta chamada.
async function createOneItemOrder(productId: string, quantity: number, overrides: Record<string, string> = {}) {
  await createOrder(fd({
    channel: 'DIRETA',
    orderDate: '2026-09-01',
    deliveryDate: '2026-09-20',
    ...overrides,
    itemsJson: JSON.stringify([{ productId, colorComboKey: null, quantity, unitPrice: 30 }]),
  }))
  const order = await prisma.order.findFirstOrThrow({ orderBy: { createdAt: 'desc' }, include: { items: true } })
  return order.items.find((i) => i.productId === productId)!
}

function draftFd(opts: { itemUpdates?: { id: string; quantity: number; unitPrice: number }[]; removedItemIds?: string[]; newItems?: object[]; deliveryDate?: string }): FormData {
  const f = new FormData()
  f.set('itemUpdatesJson', JSON.stringify(opts.itemUpdates ?? []))
  f.set('removedItemIdsJson', JSON.stringify(opts.removedItemIds ?? []))
  if (opts.newItems) f.set('newItemsJson', JSON.stringify(opts.newItems))
  if (opts.deliveryDate) f.set('deliveryDate', opts.deliveryDate)
  return f
}

// Redesign "Pedidos" §2: o drawer de detalhe salva TUDO que mudou numa
// sessão de edição de uma vez só -- updateOrderDraft é a action nova que
// orquestra isso (reaproveitando as mesmas guardas/reconciliação que
// updateOrderItem/removeOrderItem/addOrderItems já tinham cada um
// separado).
describe('updateOrderDraft', () => {
  it('aumenta quantidade de item existente -- reconcilia e pode entrar na fila de produção', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)
    expect(item.status).toBe('AGUARDANDO_PRODUCAO')

    const result = await updateOrderDraft(item.orderId, draftFd({ itemUpdates: [{ id: item.id, quantity: 5, unitPrice: 30 }] }))
    expect(result.success).toBe(true)

    const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(updated.quantity).toBe(5)
    expect(updated.status).toBe('AGUARDANDO_PRODUCAO')
  })

  it('diminui quantidade de item já parcialmente reservado -- sobra libera pro próximo pedido da fila', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '2')

    const item = await createOneItemOrder(product.id, 3, { deliveryDate: '2026-09-10' })
    expect(item.status).toBe('PARCIAL_AGUARDANDO_PRODUCAO')
    expect(item.reservedQuantity).toBe(2)

    // 2º pedido, prazo mais longe -- não deveria ganhar nada do estoque
    // (já todo reservado pelo 1º, mais urgente).
    const item2 = await createOneItemOrder(product.id, 1, { deliveryDate: '2026-09-25' })
    expect(item2.status).toBe('AGUARDANDO_PRODUCAO')
    expect(item2.reservedQuantity).toBe(0)

    // Diminui o 1º pedido de 3 pra 1 -- libera 1 peça, que deve ir pro 2º
    // pedido da fila (prazo mais longe, mas é o único concorrente).
    const result = await updateOrderDraft(item.orderId, draftFd({ itemUpdates: [{ id: item.id, quantity: 1, unitPrice: 30 }] }))
    expect(result.success).toBe(true)

    const updated1 = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(updated1.quantity).toBe(1)
    expect(updated1.reservedQuantity).toBe(1)
    expect(updated1.status).toBe('PRONTO_RESERVADO')

    const updated2 = await prisma.orderItem.findUniqueOrThrow({ where: { id: item2.id } })
    expect(updated2.reservedQuantity).toBe(1)
    expect(updated2.status).toBe('PRONTO_RESERVADO')
  })

  it('adiciona item novo no mesmo draft', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)
    const { product: product2 } = await (async () => {
      const printer = await prisma.printer.findFirstOrThrow()
      const filament = await prisma.filament.findFirstOrThrow()
      const p2 = await prisma.product.create({
        data: { name: 'Peça 2', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 20, printTimeHours: 1, laborTimeHours: 0.1 },
      })
      return { product: p2 }
    })()

    const result = await updateOrderDraft(item.orderId, draftFd({ newItems: [{ productId: product2.id, colorComboKey: null, quantity: 4, unitPrice: 45 }] }))
    expect(result.success).toBe(true)

    const items = await prisma.orderItem.findMany({ where: { orderId: item.orderId } })
    expect(items).toHaveLength(2)
    const newItem = items.find((i) => i.productId === product2.id)
    expect(newItem?.quantity).toBe(4)
    expect(newItem?.unitPrice.toNumber()).toBe(45)
  })

  it('remove item', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)
    const printer = await prisma.printer.findFirstOrThrow()
    const filament = await prisma.filament.findFirstOrThrow()
    const product2 = await prisma.product.create({
      data: { name: 'Peça 2', category: 'Chaveiro', printerId: printer.id, filamentId: filament.id, weightGrams: 20, printTimeHours: 1, laborTimeHours: 0.1 },
    })
    await prisma.orderItem.create({ data: { orderId: item.orderId, productId: product2.id, quantity: 1, unitPrice: 10 } })

    const result = await updateOrderDraft(item.orderId, draftFd({ removedItemIds: [item.id] }))
    expect(result.success).toBe(true)

    const remaining = await prisma.orderItem.findMany({ where: { orderId: item.orderId } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].productId).toBe(product2.id)
  })

  it('muda deliveryDate do pedido', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)

    const result = await updateOrderDraft(item.orderId, draftFd({ deliveryDate: '2026-10-05' }))
    expect(result.success).toBe(true)

    const order = await prisma.order.findUniqueOrThrow({ where: { id: item.orderId } })
    expect(order.deliveryDate.toISOString().slice(0, 10)).toBe('2026-10-05')
  })

  it('bloqueia edição de item que já virou venda (saleId setado)', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '3')
    const item = await createOneItemOrder(product.id, 3)
    await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))

    const delivered = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(delivered.saleId).not.toBeNull()

    const result = await updateOrderDraft(item.orderId, draftFd({ itemUpdates: [{ id: item.id, quantity: 1, unitPrice: 30 }] }))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/venda/)
  })

  it('cria exatamente 1 OrderEditLog por chamada, cobrindo todas as mudanças da sessão', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)

    const result = await updateOrderDraft(item.orderId, draftFd({
      itemUpdates: [{ id: item.id, quantity: 5, unitPrice: 40 }],
      deliveryDate: '2026-10-01',
    }))
    expect(result.success).toBe(true)

    const logs = await prisma.orderEditLog.findMany({ where: { orderId: item.orderId } })
    expect(logs).toHaveLength(1)
    const changes = logs[0].changes as { label: string; from: string; to: string }[]
    expect(changes.length).toBe(3) // quantidade + valor + entrega
  })

  it('não grava OrderEditLog quando nada muda de fato', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)

    const result = await updateOrderDraft(item.orderId, draftFd({ itemUpdates: [{ id: item.id, quantity: 2, unitPrice: 30 }] }))
    expect(result.success).toBe(true)

    const logs = await prisma.orderEditLog.findMany({ where: { orderId: item.orderId } })
    expect(logs).toHaveLength(0)
  })

  it('não deixa remover o último item do pedido', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)

    const result = await updateOrderDraft(item.orderId, draftFd({ removedItemIds: [item.id] }))
    expect(result.success).toBe(false)
  })
})

describe('getOrderEditHistory', () => {
  it('devolve os logs em ordem decrescente de criação', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)

    await updateOrderDraft(item.orderId, draftFd({ itemUpdates: [{ id: item.id, quantity: 3, unitPrice: 30 }] }))
    await updateOrderDraft(item.orderId, draftFd({ itemUpdates: [{ id: item.id, quantity: 4, unitPrice: 30 }] }))

    const history = await getOrderEditHistory(item.orderId)
    expect(history).toHaveLength(2)
    expect(history[0].createdAt.getTime()).toBeGreaterThanOrEqual(history[1].createdAt.getTime())
  })
})

// Pedido do usuário "opção de editar o valor mesmo depois de entregue":
// item com saleId/consignmentDeliveryId setado ficava travado por inteiro
// -- updateDeliveredItemPrice reabre só o campo de valor, recalculando o
// costSnapshot da Sale (preço novo muda taxa % de plataforma) e gravando 1
// OrderEditLog, igual qualquer outra edição de pedido.
describe('updateDeliveredItemPrice', () => {
  it('edita o valor de um item que já virou Sale -- atualiza Sale.unitPrice, costSnapshot e OrderItem.unitPrice', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '3')
    const item = await createOneItemOrder(product.id, 3)
    await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))

    const delivered = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(delivered.saleId).not.toBeNull()

    const result = await updateDeliveredItemPrice(item.id, fd({ unitPrice: '45' }))
    expect(result.success).toBe(true)

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: delivered.saleId! } })
    expect(sale.unitPrice.toNumber()).toBe(45)
    expect(sale.costSnapshot).not.toBeNull()

    const updatedItem = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(updatedItem.unitPrice.toNumber()).toBe(45)

    const logs = await prisma.orderEditLog.findMany({ where: { orderId: item.orderId } })
    expect(logs).toHaveLength(1)
    const changes = logs[0].changes as { label: string; from: string; to: string }[]
    expect(changes[0].label).toMatch(/valor \(pós-entrega\)/)
  })

  it('edita o valor de um item que já virou ConsignmentDelivery -- atualiza ConsignmentDelivery.unitPrice', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '2')
    const partner = await prisma.consignmentPartner.create({ data: { name: 'Parceiro Teste', defaultCommissionPercent: 0.3 } })
    await createOrder(fd({
      channel: 'CONSIGNADO',
      orderDate: '2026-09-01',
      deliveryDate: '2026-09-20',
      consignmentPartnerId: partner.id,
      itemsJson: JSON.stringify([{ productId: product.id, colorComboKey: null, quantity: 2, unitPrice: 20 }]),
    }))
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))

    const delivered = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(delivered.consignmentDeliveryId).not.toBeNull()

    const result = await updateDeliveredItemPrice(item.id, fd({ unitPrice: '28' }))
    expect(result.success).toBe(true)

    const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({ where: { id: delivered.consignmentDeliveryId! } })
    expect(delivery.unitPrice.toNumber()).toBe(28)
  })

  it('rejeita editar valor de item que ainda não foi entregue', async () => {
    const { product } = await createSupportRecords()
    const item = await createOneItemOrder(product.id, 2)

    const result = await updateDeliveredItemPrice(item.id, fd({ unitPrice: '99' }))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/não foi entregue/)
  })

  it('não grava OrderEditLog quando o valor enviado é igual ao atual', async () => {
    const { product, printer, filament } = await createSupportRecords()
    await produce(product.id, printer.id, filament.id, '3')
    const item = await createOneItemOrder(product.id, 3)
    await updateOrderItemStatus(item.id, fd({ status: 'ENTREGUE' }))

    const result = await updateDeliveredItemPrice(item.id, fd({ unitPrice: '30' }))
    expect(result.success).toBe(true)

    const logs = await prisma.orderEditLog.findMany({ where: { orderId: item.orderId } })
    expect(logs).toHaveLength(0)
  })
})
