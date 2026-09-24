import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, getOrderablePartOptions, getOrderDemandQueue } from '@/actions/orders'
import { createProductionRun } from '@/actions/productionRuns'
import { confirmAssembly } from '@/actions/assembly'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.orderReallocation.deleteMany()
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

// Produto composto com 2 peças de cor variável (1 ProductPartFilament cada)
// -- CABEÇA e CORPO, cada uma podendo ser impressa em qualquer filamento
// cadastrado, sem receita fixa.
async function createCompositeProduct() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const vermelho = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Vermelho', colorHex: '#ff0000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const azul = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', rollNumber: 2, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })

  const product = await prisma.product.create({
    data: { name: 'ZZ Boneco', category: 'Decoração', isComposite: true, printerId: printer.id, filamentId: vermelho.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0 },
  })
  const cabeca = await prisma.productPart.create({
    data: { productId: product.id, name: 'CABEÇA', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: vermelho.id, weightGrams: 10 }] } },
  })
  const corpo = await prisma.productPart.create({
    data: { productId: product.id, name: 'CORPO', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: vermelho.id, weightGrams: 20 }] } },
  })

  return { printer, vermelho, azul, product, cabeca, corpo }
}

async function producePart(productId: string, partId: string, printerId: string, filamentId: string, quantitySuccess: number) {
  return createProductionRun(fd({
    productId,
    productPartId: partId,
    printerId,
    filamentId,
    date: '2026-09-01',
    quantityPlanned: String(quantitySuccess),
    quantitySuccess: String(quantitySuccess),
    quantityFailed: '0',
    gramsUsed: '10',
    gramsWasted: '0',
    timeWastedHours: '0',
  }))
}

function orderFdWithColors(productId: string, colorChoices: Record<string, string>, overrides: Record<string, string> = {}): FormData {
  return fd({
    productId,
    channel: 'DIRETA',
    quantity: '1',
    unitPrice: '30',
    orderDate: '2026-09-01',
    deliveryDate: '2026-09-20',
    colorChoicesJson: JSON.stringify(colorChoices),
    ...overrides,
  })
}

describe('getOrderablePartOptions', () => {
  it('peça de cor variável lista o catálogo inteiro de filamento, com available certo pra cor já produzida', async () => {
    const { product, cabeca, printer, vermelho, azul } = await createCompositeProduct()
    await producePart(product.id, cabeca.id, printer.id, vermelho.id, 5)

    const options = await getOrderablePartOptions(product.id)
    const cabecaOption = options.find((o) => o.partId === cabeca.id)!
    expect(cabecaOption.fixed).toBe(false)

    const vermelhoOpt = cabecaOption.colorOptions.find((c) => c.key === vermelho.id)
    expect(vermelhoOpt?.available).toBe(5)
    // Azul nunca foi produzido pra essa peça -- ainda assim aparece no
    // catálogo, com available 0 (escolhível mesmo sem estoque).
    const azulOpt = cabecaOption.colorOptions.find((c) => c.key === azul.id)
    expect(azulOpt?.available).toBe(0)
  })

  it('peça de receita fixa (2+ filamentos) não aparece como escolhível -- vem com fixed:true e colorOptions vazio', async () => {
    const { product, printer, vermelho, azul } = await createCompositeProduct()
    // Adiciona uma peça de receita fixa (BASE: vermelho + azul juntos).
    const base = await prisma.productPart.create({
      data: {
        productId: product.id,
        name: 'BASE',
        printerId: printer.id,
        printTimeHours: 1,
        quantityPerUnit: 1,
        filamentComponents: { create: [{ filamentId: vermelho.id, weightGrams: 5 }, { filamentId: azul.id, weightGrams: 5 }] },
      },
    })

    const options = await getOrderablePartOptions(product.id)
    const baseOption = options.find((o) => o.partId === base.id)!
    expect(baseOption.fixed).toBe(true)
    expect(baseOption.colorOptions).toHaveLength(0)
    expect(baseOption.fixedLabel).toContain('Vermelho')
    expect(baseOption.fixedLabel).toContain('Azul')
  })
})

describe('createOrder com colorChoicesJson (encomenda personalizada)', () => {
  it('combo já montado em estoque -- pedido nasce direto Pronto — reservado', async () => {
    const { product, cabeca, corpo, printer, azul } = await createCompositeProduct()
    await producePart(product.id, cabeca.id, printer.id, azul.id, 2)
    await producePart(product.id, corpo.id, printer.id, azul.id, 2)
    const assemble = await confirmAssembly(fd({
      productId: product.id,
      quantity: '2',
      notes: '',
      colorChoicesJson: JSON.stringify({ [cabeca.id]: azul.id, [corpo.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(assemble.success).toBe(true)

    const result = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id, [corpo.id]: azul.id }, { quantity: '2' }))
    expect(result.success).toBe(true)

    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(order.status).toBe('PRONTO_RESERVADO')
    expect(order.reservedQuantity).toBe(2)
  })

  it('peças soltas disponíveis na cor pedida (produzidas mas não montadas) -- pedido vira Aguardando montagem', async () => {
    const { product, cabeca, corpo, printer, azul } = await createCompositeProduct()
    await producePart(product.id, cabeca.id, printer.id, azul.id, 3)
    await producePart(product.id, corpo.id, printer.id, azul.id, 3)

    const result = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id, [corpo.id]: azul.id }, { quantity: '2' }))
    expect(result.success).toBe(true)

    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(order.status).toBe('AGUARDANDO_MONTAGEM')
    expect(order.reservedQuantity).toBe(0)
  })

  it('nada disponível (cor nunca produzida) -- pedido vira Aguardando produção', async () => {
    const { product, cabeca, corpo, azul } = await createCompositeProduct()

    const result = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id, [corpo.id]: azul.id }, { quantity: '1' }))
    expect(result.success).toBe(true)

    const order = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(order.status).toBe('AGUARDANDO_PRODUCAO')
    expect(order.reservedQuantity).toBe(0)
  })

  it('rejeita combinação com peça de receita fixa recebendo escolha de cor', async () => {
    const { product, cabeca, corpo, printer, vermelho, azul } = await createCompositeProduct()
    const base = await prisma.productPart.create({
      data: {
        productId: product.id,
        name: 'BASE',
        printerId: printer.id,
        printTimeHours: 1,
        quantityPerUnit: 1,
        filamentComponents: { create: [{ filamentId: vermelho.id, weightGrams: 5 }, { filamentId: azul.id, weightGrams: 5 }] },
      },
    })

    const result = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id, [corpo.id]: azul.id, [base.id]: azul.id }))
    expect(result.success).toBe(false)
  })

  it('rejeita combinação incompleta (peça de cor variável sem escolha)', async () => {
    const { product, cabeca, azul } = await createCompositeProduct()
    const result = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id }))
    expect(result.success).toBe(false)
  })
})

describe('getOrderDemandQueue -- isolamento por cor entre pedidos do mesmo produto composto', () => {
  it('2 pedidos de cores DIFERENTES: peça solta de uma cor não é contada como disponível pro pedido da outra cor', async () => {
    const { product, cabeca, corpo, printer, vermelho, azul } = await createCompositeProduct()
    // Só produz peças soltas em VERMELHO (não em azul).
    await producePart(product.id, cabeca.id, printer.id, vermelho.id, 5)
    await producePart(product.id, corpo.id, printer.id, vermelho.id, 5)

    const orderVermelho = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: vermelho.id, [corpo.id]: vermelho.id }, { quantity: '1', deliveryDate: '2026-09-10' }))
    expect(orderVermelho.success).toBe(true)
    const orderAzul = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id, [corpo.id]: azul.id }, { quantity: '1', deliveryDate: '2026-09-15' }))
    expect(orderAzul.success).toBe(true)

    const [refreshedVermelho, refreshedAzul] = await Promise.all([
      prisma.order.findFirstOrThrow({ where: { productId: product.id, colorComboKey: { contains: vermelho.id } } }),
      prisma.order.findFirstOrThrow({ where: { productId: product.id, colorComboKey: { contains: azul.id } } }),
    ])
    // Vermelho tem peça solta disponível -- vira Aguardando montagem.
    expect(refreshedVermelho.status).toBe('AGUARDANDO_MONTAGEM')
    // Azul não tem NENHUMA peça solta nessa cor -- não pode "roubar" a peça
    // vermelha, continua Aguardando produção.
    expect(refreshedAzul.status).toBe('AGUARDANDO_PRODUCAO')

    const queue = await getOrderDemandQueue()
    const assemblyRow = queue.assemblyRows.find((r) => r.orderId === refreshedVermelho.id)
    expect(assemblyRow).toBeDefined()
    expect(assemblyRow?.neededUnits).toBe(1)

    // A linha de produção do pedido azul deve pedir a peça em AZUL
    // especificamente (comboLabel), não em qualquer cor.
    const productionRowsForAzul = queue.productionRows.filter((r) => r.orderId === refreshedAzul.id)
    expect(productionRowsForAzul.length).toBeGreaterThan(0)
    for (const row of productionRowsForAzul) {
      expect(row.filamentIds).toEqual([azul.id])
    }
  })
})

// Bug "pedido genérico não migra sozinho mesmo com peça pronta montada":
// confirmAssembly só reconciliava o colorComboKey EXATO recém-montado --
// um pedido sem cor específica (colorComboKey null, a maioria dos
// pedidos, já que "variação personalizada" é opt-in) nunca era
// reconciliado por uma montagem de cor específica, mesmo sobrando estoque
// pronto suficiente pra ele. Ficava preso mostrando "falta produzir" peça
// por peça pra sempre, mesmo com uma unidade inteira pronta em Meu
// Estoque. Fix: confirmAssembly reconcilia TODO colorComboKey pendente do
// produto (mesmo padrão já usado em maybeReconcileAfterProduction).
describe('confirmAssembly reconcilia pedido genérico (sem cor específica)', () => {
  it('pedido sem cor específica vira Pronto — reservado assim que QUALQUER combo é montado', async () => {
    const { product, cabeca, corpo, printer, azul } = await createCompositeProduct()

    // Pedido genérico, criado ANTES de qualquer peça existir -- nasce
    // Aguardando produção, sem colorComboKey nenhum.
    const orderResult = await createOrder(fd({
      productId: product.id,
      channel: 'DIRETA',
      quantity: '1',
      unitPrice: '30',
      orderDate: '2026-09-01',
      deliveryDate: '2026-09-20',
    }))
    expect(orderResult.success).toBe(true)
    const genericOrder = await prisma.order.findFirstOrThrow({ where: { productId: product.id } })
    expect(genericOrder.colorComboKey).toBeNull()
    expect(genericOrder.status).toBe('AGUARDANDO_PRODUCAO')

    // Produz e monta 1 unidade inteira numa cor ESPECÍFICA (azul) -- o
    // pedido genérico não pediu cor nenhuma, então deveria aceitar
    // qualquer uma.
    await producePart(product.id, cabeca.id, printer.id, azul.id, 1)
    await producePart(product.id, corpo.id, printer.id, azul.id, 1)
    const assemble = await confirmAssembly(fd({
      productId: product.id,
      quantity: '1',
      notes: '',
      colorChoicesJson: JSON.stringify({ [cabeca.id]: azul.id, [corpo.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(assemble.success).toBe(true)

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: genericOrder.id } })
    expect(refreshed.status).toBe('PRONTO_RESERVADO')
    expect(refreshed.reservedQuantity).toBe(1)

    // A fila de demanda de Produção não deve mais pedir peça nenhuma pra
    // este pedido -- já está totalmente coberto pela unidade pronta.
    const queue = await getOrderDemandQueue()
    expect(queue.productionRows.some((r) => r.orderId === genericOrder.id)).toBe(false)
    expect(queue.assemblyRows.some((r) => r.orderId === genericOrder.id)).toBe(false)
  })
})
