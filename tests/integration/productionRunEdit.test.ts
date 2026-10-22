import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, getOrderDemandQueue } from '@/actions/orders'
import { createProductionRun, deleteProductionRun, updateProductionRunFull, updateProductionRunQuantities, getProductionRunEditData } from '@/actions/productionRuns'
import { confirmAssembly } from '@/actions/assembly'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderReallocation.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.stockConsumption.deleteMany()
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productPartFilament.deleteMany()
  await prisma.productPart.deleteMany()
  await prisma.product.deleteMany()
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

async function stock(id: string): Promise<number> {
  return (await prisma.filament.findUniqueOrThrow({ where: { id } })).currentStockGrams.toNumber()
}

async function setup() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const preto = await prisma.filament.create({ data: { manufacturer: 'A', material: 'PLA', colorName: 'Preto', colorHex: '#111111', currentStockGrams: 1000, avgUnitCostPerGram: 0.08 } })
  const branco = await prisma.filament.create({ data: { manufacturer: 'A', material: 'PLA', colorName: 'Branco', colorHex: '#ffffff', currentStockGrams: 500, avgUnitCostPerGram: 0.08 } })
  const product = await prisma.product.create({
    data: { name: 'BONECO', category: 'Decoração', isComposite: true, printerId: printer.id, filamentId: preto.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0 },
  })
  const cabeca = await prisma.productPart.create({
    data: { productId: product.id, name: 'CABEÇA', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: preto.id, weightGrams: 10 }] } },
  })
  const corpo = await prisma.productPart.create({
    data: { productId: product.id, name: 'CORPO', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: preto.id, weightGrams: 20 }] } },
  })
  return { printer, preto, branco, product, cabeca, corpo }
}

async function produce(productId: string, partId: string, printerId: string, filamentId: string, qty: number, gramsPerUnit = 10) {
  const result = await createProductionRun(fd({
    productId, productPartId: partId, printerId, filamentId, date: '2026-09-01',
    quantityPlanned: String(qty), quantitySuccess: String(qty), quantityFailed: '0',
    gramsUsed: String(gramsPerUnit * qty), gramsWasted: '0', timeWastedHours: '0',
  }))
  expect(result.success).toBe(true)
  return prisma.productionRun.findFirstOrThrow({ where: { productPartId: partId }, orderBy: { createdAt: 'desc' } })
}

describe('updateProductionRunFull', () => {
  it('muda gramas do mesmo rolo: estoque ajustado pela diferença, custo e quantidades refeitos', async () => {
    const { printer, preto, product, cabeca } = await setup()
    const run = await produce(product.id, cabeca.id, printer.id, preto.id, 2, 10) // 20 g
    expect(await stock(preto.id)).toBe(980)
    const before = await getProductionRunEditData(run.id)

    const result = await updateProductionRunFull(run.id, { ...before, filaments: [{ filamentId: preto.id, weightGramsPerUnit: 15, gramsWasted: 0 }] })
    expect(result.success).toBe(true)
    expect(await stock(preto.id)).toBe(970) // 30 g
    const edited = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(edited.gramsUsed.toNumber()).toBe(30)
    expect(edited.status).toBe('CONCLUIDA')
    expect(edited.costSnapshot).not.toBeNull()
  })

  it('troca de rolo: devolve ao antigo e debita o novo; desfazer (previous) restaura tudo', async () => {
    const { printer, preto, branco, product, cabeca } = await setup()
    const run = await produce(product.id, cabeca.id, printer.id, preto.id, 2, 10)
    const before = await getProductionRunEditData(run.id)

    const result = await updateProductionRunFull(run.id, { ...before, filaments: [{ filamentId: branco.id, weightGramsPerUnit: 10, gramsWasted: 0 }] })
    expect(result.success).toBe(true)
    expect(await stock(preto.id)).toBe(1000)
    expect(await stock(branco.id)).toBe(480)
    expect((await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).filamentId).toBe(branco.id)

    const undo = await updateProductionRunFull(run.id, result.previous!)
    expect(undo.success).toBe(true)
    expect(await stock(preto.id)).toBe(980)
    expect(await stock(branco.id)).toBe(500)
  })

  it('rolo novo sem estoque: recusa e não muda nada', async () => {
    const { printer, preto, branco, product, cabeca } = await setup()
    const run = await produce(product.id, cabeca.id, printer.id, preto.id, 2, 10)
    const before = await getProductionRunEditData(run.id)

    const result = await updateProductionRunFull(run.id, { ...before, filaments: [{ filamentId: branco.id, weightGramsPerUnit: 400, gramsWasted: 0 }] })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/insuficiente/i)
    expect(await stock(preto.id)).toBe(980)
    expect(await stock(branco.id)).toBe(500)
    expect((await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).filamentId).toBe(preto.id)
  })

  it('crédito do próprio consumo conta: pode aumentar mesmo com pouco estoque sobrando', async () => {
    const { printer, preto, product, cabeca } = await setup()
    await prisma.filament.update({ where: { id: preto.id }, data: { currentStockGrams: 100 } })
    const run = await produce(product.id, cabeca.id, printer.id, preto.id, 5, 10) // 50 g, sobram 50
    const before = await getProductionRunEditData(run.id)
    // Novo total 90 g: precisa de +40 (sobram 50) -- ok. 120 g não cabe nos 100 originais.
    expect((await updateProductionRunFull(run.id, { ...before, filaments: [{ filamentId: preto.id, weightGramsPerUnit: 18, gramsWasted: 0 }] })).success).toBe(true)
    expect(await stock(preto.id)).toBe(10)
    expect((await updateProductionRunFull(run.id, { ...before, filaments: [{ filamentId: preto.id, weightGramsPerUnit: 24, gramsWasted: 0 }] })).success).toBe(false)
  })

  it('falhas mudam o status (Com falhas) e desperdício consome rolo', async () => {
    const { printer, preto, product, cabeca } = await setup()
    const run = await produce(product.id, cabeca.id, printer.id, preto.id, 3, 10)
    const result = await updateProductionRunQuantities(run.id, 2, 1)
    expect(result.success).toBe(true)
    const edited = await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })
    expect([edited.quantityPlanned, edited.quantitySuccess, edited.quantityFailed, edited.status]).toEqual([3, 2, 1, 'COM_FALHAS'])
    expect(await stock(preto.id)).toBe(970)
    expect((await updateProductionRunQuantities(run.id, 0, 0)).success).toBe(false)
  })

  it('reduzir sucesso de peça já montada desmonta só o excedente', async () => {
    const { printer, preto, product, cabeca, corpo } = await setup()
    const c = await produce(product.id, cabeca.id, printer.id, preto.id, 2, 10)
    await produce(product.id, corpo.id, printer.id, preto.id, 2, 20)
    const assemble = await confirmAssembly(fd({
      productId: product.id, quantity: '2', notes: '',
      colorChoicesJson: JSON.stringify({ [cabeca.id]: preto.id, [corpo.id]: preto.id }), accessoryUsagesJson: '[]', supplyUsagesJson: '[]',
    }))
    expect(assemble.success).toBe(true)

    const result = await updateProductionRunQuantities(c.id, 1, 0)
    expect(result.success).toBe(true)
    const assembled = await prisma.productAssembly.aggregate({ where: { productId: product.id }, _sum: { quantity: true } })
    expect(assembled._sum.quantity).toBe(1)
  })

  it('pendência do pedido é derivada: editar e excluir devolvem a diferença certa', async () => {
    const { printer, preto, product, cabeca, corpo } = await setup()
    const order = await createOrder(fd({
      channel: 'DIRETA', orderDate: '2026-09-01', deliveryDate: '2026-09-20',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 2, unitPrice: 30 }]),
    }))
    expect(order.success).toBe(true)
    await produce(product.id, corpo.id, printer.id, preto.id, 2, 20)
    const run = await produce(product.id, cabeca.id, printer.id, preto.id, 2, 10)

    const missing = async () => (await getOrderDemandQueue()).productionRows.filter((r) => r.partName === 'CABEÇA').reduce((s, r) => s + r.neededUnits, 0)
    expect(await missing()).toBe(0)

    expect((await updateProductionRunQuantities(run.id, 1, 0)).success).toBe(true)
    expect(await missing()).toBe(1)

    expect((await deleteProductionRun(run.id)).success).toBe(true)
    expect(await missing()).toBe(2)
  })
})
