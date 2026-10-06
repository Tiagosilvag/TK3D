import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createOrder, getOrderablePartOptions, getOrderDemandQueue, resolveOrderItemColorLabel } from '@/actions/orders'
import { createProductionRun } from '@/actions/productionRuns'
import { confirmAssembly } from '@/actions/assembly'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
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

// Produto composto com 2 peças de cor variável (1 ProductPartFilament cada)
// -- CABEÇA e CORPO, cada uma podendo ser impressa em qualquer filamento
// cadastrado, sem receita fixa.
async function createCompositeProduct() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const vermelho = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Vermelho', colorHex: '#ff0000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const azul = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })

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

// Melhoria "Pedidos com múltiplos itens": createOrder recebe o cabeçalho
// solto + itemsJson com 1 item -- este helper monta esse envelope (mesmo
// contrato que orderFd em orderReservations.test.ts), com colorChoicesJson
// dentro do próprio item.
function orderFdWithColors(productId: string, colorChoices: Record<string, string>, overrides: { quantity?: string; unitPrice?: string; deliveryDate?: string } = {}): FormData {
  return fd({
    channel: 'DIRETA',
    orderDate: '2026-09-01',
    deliveryDate: overrides.deliveryDate ?? '2026-09-20',
    itemsJson: JSON.stringify([{
      productId,
      colorChoicesJson: JSON.stringify(colorChoices),
      quantity: Number(overrides.quantity ?? '1'),
      unitPrice: Number(overrides.unitPrice ?? '30'),
    }]),
  })
}

// Produto simples (sem ProductPart, sem insumo/acessório) -- "+ Montar
// variação personalizada" também vale pra esse caso (bug "sem opção de
// variação nova pra produto simples"), mas o colorComboKey resultante
// precisa ser o filamentId PURO (convenção de produto sem montagem),
// nunca o formato serializado partId:comboKey.
async function createSimpleProduct() {
  const printer = await prisma.printer.create({ data: { name: 'P2', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const vermelho = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Vermelho', colorHex: '#ff0000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const azul = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
  const product = await prisma.product.create({
    data: { name: 'Chaveiro Simples', category: 'Chaveiro', printerId: printer.id, filamentId: vermelho.id, weightGrams: 10, printTimeHours: 0.5, laborTimeHours: 0.1 },
  })
  return { printer, vermelho, azul, product }
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

  // Pedido do usuário "receita fixa em qualquer peça": ProductPart.fixedRecipe
  // deixa fixar a cor de uma peça de 1 FILAMENTO SÓ também (até aqui só
  // peça de 2+ filamentos virava fixa, sempre derivado da contagem).
  it('peça de 1 filamento marcada fixedRecipe também vira fixa, mesmo sem 2+ componentes', async () => {
    const { product, cabeca } = await createCompositeProduct()
    await prisma.productPart.update({ where: { id: cabeca.id }, data: { fixedRecipe: true } })

    const options = await getOrderablePartOptions(product.id)
    const cabecaOption = options.find((o) => o.partId === cabeca.id)!
    expect(cabecaOption.fixed).toBe(true)
    expect(cabecaOption.colorOptions).toHaveLength(0)
    expect(cabecaOption.fixedLabel).toContain('Vermelho')
  })

  it('peça de 1 filamento com fixedRecipe=false (default) continua cor variável como sempre foi', async () => {
    const { product, cabeca } = await createCompositeProduct()

    const options = await getOrderablePartOptions(product.id)
    const cabecaOption = options.find((o) => o.partId === cabeca.id)!
    expect(cabecaOption.fixed).toBe(false)
    expect(cabecaOption.colorOptions.length).toBeGreaterThan(0)
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

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('PRONTO_RESERVADO')
    expect(item.reservedQuantity).toBe(2)
  })

  it('peças soltas disponíveis na cor pedida (produzidas mas não montadas) -- pedido vira Aguardando montagem', async () => {
    const { product, cabeca, corpo, printer, azul } = await createCompositeProduct()
    await producePart(product.id, cabeca.id, printer.id, azul.id, 3)
    await producePart(product.id, corpo.id, printer.id, azul.id, 3)

    const result = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id, [corpo.id]: azul.id }, { quantity: '2' }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('AGUARDANDO_MONTAGEM')
    expect(item.reservedQuantity).toBe(0)
  })

  it('nada disponível (cor nunca produzida) -- pedido vira Aguardando produção', async () => {
    const { product, cabeca, corpo, azul } = await createCompositeProduct()

    const result = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id, [corpo.id]: azul.id }, { quantity: '1' }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('AGUARDANDO_PRODUCAO')
    expect(item.reservedQuantity).toBe(0)
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

describe('bug "sem opção de variação nova pra produto simples": variação personalizada também vale sem montagem', () => {
  it('getOrderablePartOptions devolve 1 peça sintética (key=productId) com o catálogo inteiro de filamento', async () => {
    const { product, vermelho, azul } = await createSimpleProduct()
    const options = await getOrderablePartOptions(product.id)
    expect(options).toHaveLength(1)
    expect(options[0].partId).toBe(product.id)
    expect(options[0].fixed).toBe(false)
    expect(options[0].colorOptions.map((o) => o.key).sort()).toEqual([azul.id, vermelho.id].sort())
  })

  // Bug "não fazia sentido pedir cor sem filamento em estoque": pedir uma
  // cor cujo filamento cru tem 0g sempre travava depois em "Registrar
  // produção" (estoque insuficiente) -- beco sem saída. Filamento com 0g
  // não deveria nem aparecer como opção pedível.
  it('filamento com 0g de estoque não aparece no catálogo de cor nunca produzida', async () => {
    const { product, vermelho } = await createSimpleProduct()
    const preto = await prisma.filament.create({ data: { manufacturer: 'F2', material: 'PLA', colorName: 'Preto', colorHex: '#000000', currentStockGrams: 0, avgUnitCostPerGram: 80 / 1000 } })
    const options = await getOrderablePartOptions(product.id)
    const keys = options[0].colorOptions.map((o) => o.key)
    expect(keys).toContain(vermelho.id)
    expect(keys).not.toContain(preto.id)
  })

  // Ajuste "SÓ filamento em estoque, produzido ou não": mesma regra vale
  // pra combo JÁ produzido -- se o filamento cru esgotou DEPOIS, o combo
  // some do seletor também (não dá pra produzir mais, só reforça o
  // problema de antes -- vender a peça física já pronta é papel de
  // Vendas/<select> de variante conhecida, não deste seletor de encomenda).
  it('filamento com 0g de estoque some do seletor mesmo se já foi produzido antes', async () => {
    const { product, printer, vermelho } = await createSimpleProduct()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: vermelho.id,
      date: '2026-09-01',
      quantityPlanned: '1',
      quantitySuccess: '1',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))
    // Esgota o filamento DEPOIS de já ter produzido com ele.
    await prisma.filament.update({ where: { id: vermelho.id }, data: { currentStockGrams: 0 } })

    const options = await getOrderablePartOptions(product.id)
    const keys = options[0].colorOptions.map((o) => o.key)
    expect(keys).not.toContain(vermelho.id)
  })

  it('colorComboKey vira o filamentId PURO (nunca o formato serializado partId:comboKey)', async () => {
    const { product, azul } = await createSimpleProduct()
    const result = await createOrder(orderFdWithColors(product.id, { [product.id]: azul.id }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.colorComboKey).toBe(azul.id)
  })

  it('cor já produzida via variação personalizada reserva igual ao <select> normal (mesma convenção de chave)', async () => {
    const { product, printer, azul } = await createSimpleProduct()
    await createProductionRun(fd({
      productId: product.id,
      printerId: printer.id,
      filamentId: azul.id,
      date: '2026-09-01',
      quantityPlanned: '2',
      quantitySuccess: '2',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
    }))

    const result = await createOrder(orderFdWithColors(product.id, { [product.id]: azul.id }, { quantity: '2' }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('PRONTO_RESERVADO')
    expect(item.reservedQuantity).toBe(2)
  })

  // Bug "não sincroniza com o pedido -- variação nova não informa a cor":
  // getOrderDemandQueue tinha um atalho pra produto !needsAssembly que
  // sempre devolvia comboLabel/filamentIds null, ignorando
  // item.colorComboKey -- Produção nunca sabia qual cor pré-selecionar
  // (nem pro botão "Registrar produção" nem pro texto da fila), mesmo o
  // pedido tendo uma cor específica gravada.
  it('getOrderDemandQueue devolve filamentIds/comboLabel da cor pedida, mesmo nunca produzida (produto simples)', async () => {
    const { product, azul } = await createSimpleProduct()
    const result = await createOrder(orderFdWithColors(product.id, { [product.id]: azul.id }, { quantity: '2' }))
    expect(result.success).toBe(true)

    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(item.status).toBe('AGUARDANDO_PRODUCAO')

    const queue = await getOrderDemandQueue()
    const row = queue.productionRows.find((r) => r.orderItemId === item.id)
    expect(row).toBeDefined()
    expect(row?.filamentIds).toEqual([azul.id])
    expect(row?.comboLabel).toContain('Azul')
  })

  // Bug "não mostra a cor da variação criada": /orders resolvia o rótulo
  // de cada item batendo colorComboKey contra combo JÁ PRODUZIDO
  // (getProductVariantStockOptions) -- uma cor pedida mas nunca impressa
  // não aparecia lá, então a tela ficava sem cor mesmo com colorComboKey
  // gravado certinho.
  it('resolveOrderItemColorLabel resolve a cor pelo catálogo, mesmo nunca produzida (produto simples)', async () => {
    const { product, azul } = await createSimpleProduct()
    const resolved = await resolveOrderItemColorLabel(product.id, azul.id)
    expect(resolved).not.toBeNull()
    expect(resolved?.label).toContain('Azul')
  })

  it('resolveOrderItemColorLabel resolve combo composto (1+ peças) nunca produzido', async () => {
    const { product, cabeca, corpo, azul } = await createCompositeProduct()
    const { serializeColorChoices } = await import('@/lib/reports')
    const comboKey = serializeColorChoices({ [cabeca.id]: azul.id, [corpo.id]: azul.id })
    const resolved = await resolveOrderItemColorLabel(product.id, comboKey)
    expect(resolved).not.toBeNull()
    expect(resolved?.label).toContain('CABEÇA')
    expect(resolved?.label).toContain('Azul')
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
      prisma.orderItem.findFirstOrThrow({ where: { productId: product.id, colorComboKey: { contains: vermelho.id } } }),
      prisma.orderItem.findFirstOrThrow({ where: { productId: product.id, colorComboKey: { contains: azul.id } } }),
    ])
    // Vermelho tem peça solta disponível -- vira Aguardando montagem.
    expect(refreshedVermelho.status).toBe('AGUARDANDO_MONTAGEM')
    // Azul não tem NENHUMA peça solta nessa cor -- não pode "roubar" a peça
    // vermelha, continua Aguardando produção.
    expect(refreshedAzul.status).toBe('AGUARDANDO_PRODUCAO')

    const queue = await getOrderDemandQueue()
    const assemblyRow = queue.assemblyRows.find((r) => r.orderItemId === refreshedVermelho.id)
    expect(assemblyRow).toBeDefined()
    expect(assemblyRow?.neededUnits).toBe(1)

    // A linha de produção do pedido azul deve pedir a peça em AZUL
    // especificamente (comboLabel), não em qualquer cor.
    const productionRowsForAzul = queue.productionRows.filter((r) => r.orderItemId === refreshedAzul.id)
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
      channel: 'DIRETA',
      orderDate: '2026-09-01',
      deliveryDate: '2026-09-20',
      itemsJson: JSON.stringify([{ productId: product.id, quantity: 1, unitPrice: 30 }]),
    }))
    expect(orderResult.success).toBe(true)
    const genericItem = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })
    expect(genericItem.colorComboKey).toBeNull()
    expect(genericItem.status).toBe('AGUARDANDO_PRODUCAO')

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

    const refreshed = await prisma.orderItem.findUniqueOrThrow({ where: { id: genericItem.id } })
    expect(refreshed.status).toBe('PRONTO_RESERVADO')
    expect(refreshed.reservedQuantity).toBe(1)

    // A fila de demanda de Produção não deve mais pedir peça nenhuma pra
    // este pedido -- já está totalmente coberto pela unidade pronta.
    const queue = await getOrderDemandQueue()
    expect(queue.productionRows.some((r) => r.orderItemId === genericItem.id)).toBe(false)
    expect(queue.assemblyRows.some((r) => r.orderItemId === genericItem.id)).toBe(false)
  })
})

// Bug "produção registrada mas pedido continua pendente pra sempre": uma
// peça de RECEITA FIXA (2+ filamentos, nunca escolhida pelo cliente --
// resolveCustomColorComboKey a exclui de `choices` de propósito, ver
// comentário lá) nunca tem entrada própria em colorComboKey quando o
// pedido escolhe cor só de OUTRA peça do mesmo produto. availableForPart
// (getOrderDemandQueue) tratava "sem escolha pra esta peça" como "escolheu
// o combo de chave vazia" (`choices[partId] ?? ''`), que nunca existe em
// comboPools -- disponível ficava 0 pra sempre pra essa peça, mesmo com
// produção real cobrindo o necessário (Montagem/getAssemblyStatus já
// contava certo -- só a fila de Produção ficava presa mostrando "falta
// produzir" uma peça já produzida o suficiente).
describe('getOrderDemandQueue -- peça de receita fixa não fica presa quando o pedido só escolhe cor de OUTRA peça', () => {
  it('peça fixa produzida some da fila mesmo com colorComboKey só da peça de cor variável', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P4', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const vermelho = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Vermelho', colorHex: '#ff0000', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    const verde = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Verde', colorHex: '#00ff00', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })
    const azul = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Azul', colorHex: '#0000ff', currentStockGrams: 1000, avgUnitCostPerGram: 80 / 1000 } })

    const product = await prisma.product.create({
      data: { name: 'MINI PATO', category: 'Decoração', isComposite: true, printerId: printer.id, filamentId: vermelho.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0 },
    })
    const cabeca = await prisma.productPart.create({
      data: { productId: product.id, name: 'CABEÇA', printerId: printer.id, printTimeHours: 1, quantityPerUnit: 1, filamentComponents: { create: [{ filamentId: vermelho.id, weightGrams: 10 }] } },
    })
    // CORPO tem receita FIXA (2 filamentos sempre juntos) -- o cliente
    // nunca escolhe a cor dela num pedido.
    const corpo = await prisma.productPart.create({
      data: {
        productId: product.id,
        name: 'CORPO',
        printerId: printer.id,
        printTimeHours: 1,
        quantityPerUnit: 1,
        filamentComponents: { create: [{ filamentId: vermelho.id, weightGrams: 10 }, { filamentId: verde.id, weightGrams: 5 }] },
      },
    })

    // Pedido escolhe cor só de CABEÇA (única peça de cor variável) -- CORPO
    // fica de fora de `choices` de propósito (receita fixa).
    const orderResult = await createOrder(orderFdWithColors(product.id, { [cabeca.id]: azul.id }, { quantity: '2' }))
    expect(orderResult.success).toBe(true)
    const item = await prisma.orderItem.findFirstOrThrow({ where: { productId: product.id } })

    // Produz as 2 CABEÇA em azul e as 2 CORPO (receita fixa) -- o suficiente
    // pra montar as 2 unidades pedidas.
    await producePart(product.id, cabeca.id, printer.id, azul.id, 2)
    const corpoResult = await createProductionRun(fd({
      productId: product.id,
      productPartId: corpo.id,
      printerId: printer.id,
      filamentId: vermelho.id,
      date: '2026-09-01',
      quantityPlanned: '2',
      quantitySuccess: '2',
      quantityFailed: '0',
      gramsUsed: '10',
      gramsWasted: '0',
      timeWastedHours: '0',
      filamentUsagesJson: JSON.stringify([
        { filamentId: vermelho.id, gramsUsed: 20, gramsWasted: 0 },
        { filamentId: verde.id, gramsUsed: 10, gramsWasted: 0 },
      ]),
    }))
    expect(corpoResult.success).toBe(true)

    // Ambas as peças produzidas o suficiente -- a fila de Produção não deve
    // pedir nada pra este item (nem CABEÇA, nem CORPO).
    const queue = await getOrderDemandQueue()
    const rowsForItem = queue.productionRows.filter((r) => r.orderItemId === item.id)
    expect(rowsForItem).toEqual([])
  })
})
