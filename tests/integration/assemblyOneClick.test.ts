import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, getOrderDemandQueue } from '@/actions/orders'
import { createProductionRun } from '@/actions/productionRuns'
import { assembleOrderItem, assembleOrderItems, assembleProductMax, undoAssemblies, updateAssemblyQuantity } from '@/actions/assembly'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.stockConsumption.deleteMany()
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.productPartFilament.deleteMany()
  await prisma.productPart.deleteMany()
  await prisma.product.deleteMany()
  await prisma.accessoryPurchase.deleteMany()
  await prisma.accessory.deleteMany({ where: { name: 'Argola Teste' } })
  await prisma.accessoryTypeRecord.deleteMany({ where: { name: 'Argola Teste Tipo' } })
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
}

beforeAll(async () => { await prisma.$connect() })
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => { await prisma.$disconnect() })

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

// Produto composto de 2 peças de cor variável + 1 acessório da ficha.
async function setup() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const preto = await prisma.filament.create({ data: { manufacturer: 'A', material: 'PLA', colorName: 'Preto', colorHex: '#111111', currentStockGrams: 5000, avgUnitCostPerGram: 0.08 } })
  const azul = await prisma.filament.create({ data: { manufacturer: 'A', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStockGrams: 5000, avgUnitCostPerGram: 0.08 } })
  const type = await prisma.accessoryTypeRecord.create({ data: { name: 'Argola Teste Tipo' } })
  const argola = await prisma.accessory.create({ data: { name: 'Argola Teste', type: type.id, colorName: 'Prata', currentStock: 100, avgUnitCost: 0.3 } })
  const product = await prisma.product.create({
    data: {
      name: 'CHAVEIRO', category: 'Chaveiro', isComposite: true, printerId: printer.id, filamentId: preto.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0,
      accessoryUsages: { create: [{ accessoryId: argola.id, quantity: 2 }] },
    },
  })
  const topo = await prisma.productPart.create({
    data: { productId: product.id, name: 'TOPO', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: preto.id, weightGrams: 10 }] } },
  })
  const base = await prisma.productPart.create({
    data: { productId: product.id, name: 'BASE', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: preto.id, weightGrams: 10 }] } },
  })
  return { printer, preto, azul, argola, product, topo, base }
}

async function produce(productId: string, partId: string, printerId: string, filamentId: string, qty: number) {
  const r = await createProductionRun(fd({
    productId, productPartId: partId, printerId, filamentId, date: '2026-09-01',
    quantityPlanned: String(qty), quantitySuccess: String(qty), quantityFailed: '0', gramsUsed: String(10 * qty), gramsWasted: '0', timeWastedHours: '0',
  }))
  expect(r.success).toBe(true)
}

async function order(productId: string, quantity: number, colorChoices: Record<string, string>, deliveryDate = '2026-09-20') {
  const r = await createOrder(fd({
    channel: 'DIRETA', orderDate: '2026-09-01', deliveryDate,
    itemsJson: JSON.stringify([{ productId, quantity, unitPrice: 20, colorChoicesJson: JSON.stringify(colorChoices) }]),
  }))
  expect(r.success).toBe(true)
}

const accessoryStock = async (id: string) => (await prisma.accessory.findUniqueOrThrow({ where: { id } })).currentStock.toNumber()

describe('assembleOrderItem / undoAssemblies', () => {
  it('monta a variação pedida em 1 clique, debita acessório, reserva o pedido; desfazer restaura tudo', async () => {
    const { printer, azul, preto, argola, product, topo, base } = await setup()
    await order(product.id, 2, { [topo.id]: azul.id, [base.id]: preto.id })
    await produce(product.id, topo.id, printer.id, azul.id, 2)
    await produce(product.id, base.id, printer.id, preto.id, 2)
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    const queueBefore = (await getOrderDemandQueue()).assemblyQueue
    expect(queueBefore).toHaveLength(1)
    expect(queueBefore[0].assemblableUnits).toBe(2)
    expect(queueBefore[0].missingParts).toEqual([])

    const result = await assembleOrderItem(item.id)
    expect(result.success).toBe(true)
    expect(result.units).toBe(2)
    const reserved = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(reserved.reservedQuantity).toBe(2)
    expect(reserved.status).toBe('PRONTO_RESERVADO')
    expect(await accessoryStock(argola.id)).toBe(96) // 2 un × 2 por unidade
    const assembly = await prisma.productAssembly.findUniqueOrThrow({ where: { id: result.assemblyId! } })
    expect(assembly.colorChoices).toEqual({ [topo.id]: azul.id, [base.id]: preto.id })

    const undo = await undoAssemblies([result.assemblyId!])
    expect(undo.success).toBe(true)
    expect(await accessoryStock(argola.id)).toBe(100)
    expect(await prisma.productAssembly.count({ where: { productId: product.id } })).toBe(0)
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(after.reservedQuantity).toBe(0)
  })

  it('monta só o que dá (parcial) e a fila mostra o que falta', async () => {
    const { printer, azul, preto, product, topo, base } = await setup()
    await order(product.id, 3, { [topo.id]: azul.id, [base.id]: preto.id })
    await produce(product.id, topo.id, printer.id, azul.id, 3)
    await produce(product.id, base.id, printer.id, preto.id, 1)
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    const q = (await getOrderDemandQueue()).assemblyQueue[0]
    expect(q.assemblableUnits).toBe(1)
    expect(q.missingParts).toEqual([{ name: 'BASE', units: 2 }])

    const result = await assembleOrderItem(item.id)
    expect(result.units).toBe(1)
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(after.reservedQuantity).toBe(1)
    expect(after.status).toBe('PARCIAL_AGUARDANDO_PRODUCAO')
    // Nada mais pra montar agora.
    const again = await assembleOrderItem(item.id)
    expect(again.success).toBe(false)
  })

  it('montar todos: itens do mesmo produto disputam as mesmas peças em ordem de prazo', async () => {
    const { printer, azul, preto, product, topo, base } = await setup()
    await order(product.id, 2, { [topo.id]: azul.id, [base.id]: preto.id }, '2026-09-10')
    await order(product.id, 2, { [topo.id]: azul.id, [base.id]: preto.id }, '2026-09-20')
    await produce(product.id, topo.id, printer.id, azul.id, 3)
    await produce(product.id, base.id, printer.id, preto.id, 3)
    const items = await prisma.orderItem.findMany({ where: { productId: product.id }, include: { order: true }, orderBy: { order: { deliveryDate: 'asc' } } })

    const result = await assembleOrderItems(items.map((i) => i.id))
    expect(result.success).toBe(true)
    expect(result.units).toBe(3) // 2 pro primeiro + 1 (o que sobrou) pro segundo
    const reserved = await Promise.all(items.map((i) => prisma.orderItem.findUniqueOrThrow({ where: { id: i.id } })))
    expect(reserved.map((r) => r.reservedQuantity)).toEqual([2, 1])
  })

  it('assembleProductMax monta o máximo com as combinações de maior estoque', async () => {
    const { printer, azul, preto, product, topo, base } = await setup()
    await produce(product.id, topo.id, printer.id, azul.id, 2)
    await produce(product.id, topo.id, printer.id, preto.id, 5)
    await produce(product.id, base.id, printer.id, preto.id, 4)
    const result = await assembleProductMax(product.id)
    expect(result.success).toBe(true)
    expect(result.units).toBe(4) // topo preto 5, base preto 4
    expect((await assembleProductMax(product.id)).success).toBe(false)
  })

  it('desfazer recusa quando as unidades já foram vendidas', async () => {
    const { printer, preto, product, topo, base } = await setup()
    await produce(product.id, topo.id, printer.id, preto.id, 2)
    await produce(product.id, base.id, printer.id, preto.id, 2)
    const result = await assembleProductMax(product.id)
    await prisma.sale.create({ data: { channel: 'DIRETA', productId: product.id, quantity: 2, unitPrice: 20, saleDate: new Date(), batchId: 'b1' } })
    const undo = await undoAssemblies([result.assemblyId!])
    expect(undo.success).toBe(false)
    expect(await prisma.productAssembly.count({ where: { productId: product.id } })).toBe(1)
  })
})

describe('updateAssemblyQuantity', () => {
  it('diminuir devolve acessório pela diferença; aumentar exige peça e debita a diferença', async () => {
    const { printer, preto, argola, product, topo, base } = await setup()
    await produce(product.id, topo.id, printer.id, preto.id, 4)
    await produce(product.id, base.id, printer.id, preto.id, 4)
    const result = await assembleProductMax(product.id) // 4
    expect(await accessoryStock(argola.id)).toBe(92)

    const down = await updateAssemblyQuantity(result.assemblyId!, 3)
    expect(down.success).toBe(true)
    expect(await accessoryStock(argola.id)).toBe(94)
    expect((await prisma.productAssembly.findUniqueOrThrow({ where: { id: result.assemblyId! } })).quantity).toBe(3)

    const up = await updateAssemblyQuantity(result.assemblyId!, 4)
    expect(up.success).toBe(true)
    expect(await accessoryStock(argola.id)).toBe(92)

    const tooMuch = await updateAssemblyQuantity(result.assemblyId!, 6)
    expect(tooMuch.success).toBe(false)
    expect(tooMuch.error).toMatch(/Faltam peças/)
    expect((await prisma.productAssembly.findUniqueOrThrow({ where: { id: result.assemblyId! } })).quantity).toBe(4)
    expect(await accessoryStock(argola.id)).toBe(92)
  })

  it('diminuir abaixo do que já foi vendido é recusado', async () => {
    const { printer, preto, product, topo, base } = await setup()
    await produce(product.id, topo.id, printer.id, preto.id, 3)
    await produce(product.id, base.id, printer.id, preto.id, 3)
    const result = await assembleProductMax(product.id)
    await prisma.sale.create({ data: { channel: 'DIRETA', productId: product.id, quantity: 2, unitPrice: 20, saleDate: new Date(), batchId: 'b2' } })
    const refused = await updateAssemblyQuantity(result.assemblyId!, 1)
    expect(refused.success).toBe(false)
    expect(refused.error).toMatch(/vendidas/)
    // Até 2 pode reduzir (as 2 vendidas continuam cobertas).
    expect((await updateAssemblyQuantity(result.assemblyId!, 2)).success).toBe(true)
  })
})
