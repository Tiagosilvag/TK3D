import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createProductionRun } from '@/actions/productionRuns'
import { confirmAssembly } from '@/actions/assembly'
import { addProductComponentUsage, removeProductComponentUsage, getProductAverageProductionCost, getProductCostBreakdown } from '@/actions/products'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productComponentUsage.deleteMany()
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

// Mosquetão: produto simples (não composto), produzido em várias cores via
// filamento escolhido na Produção -- o "componente" do pedido do usuário.
async function createMosquetao() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const azul = await prisma.filament.create({ data: { manufacturer: 'Voolt', material: 'PLA', colorName: 'Azul', colorHex: '#0000FF', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const rosa = await prisma.filament.create({ data: { manufacturer: 'Voolt', material: 'PLA', colorName: 'Rosa', colorHex: '#FFC0CB', rollNumber: 2, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const mosquetao = await prisma.product.create({
    data: { name: 'Mosquetão', category: 'Chaveiro', printerId: printer.id, filamentId: azul.id, weightGrams: 3, printTimeHours: 0.2, laborTimeHours: 0 },
  })
  return { printer, azul, rosa, mosquetao }
}

async function produceMosquetao(mosquetao: { id: string }, printer: { id: string }, filament: { id: string }, quantity: number) {
  const result = await createProductionRun(fd({
    productId: mosquetao.id,
    printerId: printer.id,
    filamentId: filament.id,
    date: '2026-09-11',
    quantityPlanned: String(quantity),
    quantitySuccess: String(quantity),
    quantityFailed: '0',
    gramsUsed: String(3 * quantity),
    gramsWasted: '0',
    timeWastedHours: '0',
  }))
  expect(result.success).toBe(true)
}

async function createChaveiro(name: string, printer: { id: string }, filament: { id: string }) {
  return prisma.product.create({
    data: { name, category: 'Chaveiro', isComposite: true, printerId: printer.id, filamentId: filament.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0 },
  })
}

describe('Produto-como-componente: Mosquetão produzido em qualquer cor via filamento (seções 1-6 do pedido)', () => {
  it('produzir o mesmo produto com filamentos diferentes gera estoque separado por cor, sem alterar o cadastro principal', async () => {
    const { printer, azul, rosa, mosquetao } = await createMosquetao()

    await produceMosquetao(mosquetao, printer, azul, 5)
    await produceMosquetao(mosquetao, printer, rosa, 3)

    // Cadastro principal nunca muda -- continua com o filamento/cor padrão original.
    const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: mosquetao.id } })
    expect(unchanged.filamentId).toBe(azul.id)

    const runs = await prisma.productionRun.findMany({ where: { productId: mosquetao.id } })
    expect(runs).toHaveLength(2)
    expect(runs.find((r) => r.filamentId === azul.id)?.quantitySuccess).toBe(5)
    expect(runs.find((r) => r.filamentId === rosa.id)?.quantitySuccess).toBe(3)
  })
})

describe('Produto-como-componente: estoque COMPARTILHADO entre produtos pai diferentes', () => {
  it('DOIS produtos pai diferentes consumindo do MESMO pool de Mosquetão -- cada consumo decrementa o outro', async () => {
    const { printer, azul, rosa, mosquetao } = await createMosquetao()
    await produceMosquetao(mosquetao, printer, azul, 5)
    await produceMosquetao(mosquetao, printer, rosa, 3)

    const chaveiroCafe = await createChaveiro('Chaveiro Café', printer, azul)
    const chaveiroPresente = await createChaveiro('Chaveiro Presente', printer, azul)

    const addA = await addProductComponentUsage(fd({ productId: chaveiroCafe.id, componentProductId: mosquetao.id, quantity: '1' }))
    expect(addA.success).toBe(true)
    const addB = await addProductComponentUsage(fd({ productId: chaveiroPresente.id, componentProductId: mosquetao.id, quantity: '1' }))
    expect(addB.success).toBe(true)

    // Chaveiro Café monta 2 usando Azul -- consome do pool compartilhado.
    const confirm1 = await confirmAssembly(fd({
      productId: chaveiroCafe.id,
      quantity: '2',
      notes: '',
      colorChoicesJson: JSON.stringify({ [mosquetao.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(confirm1.success).toBe(true)

    // Chaveiro Presente tenta montar 4 usando Azul -- só sobram 3 (5-2), deve falhar.
    const confirmTooMuch = await confirmAssembly(fd({
      productId: chaveiroPresente.id,
      quantity: '4',
      notes: '',
      colorChoicesJson: JSON.stringify({ [mosquetao.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(confirmTooMuch.success).toBe(false)

    // Mas 3 (o que sobrou de verdade) funciona -- prova que o pool é compartilhado.
    const confirm2 = await confirmAssembly(fd({
      productId: chaveiroPresente.id,
      quantity: '3',
      notes: '',
      colorChoicesJson: JSON.stringify({ [mosquetao.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(confirm2.success).toBe(true)

    // Rosa nunca foi tocado -- continua com os 3 originais, disponível pra qualquer um dos dois.
    const confirm3 = await confirmAssembly(fd({
      productId: chaveiroCafe.id,
      quantity: '3',
      notes: '',
      colorChoicesJson: JSON.stringify({ [mosquetao.id]: rosa.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(confirm3.success).toBe(true)
  })

  it('Meu Estoque (getOwnStockSummary) do Mosquetão reflete o consumo como componente de outro produto', async () => {
    const { getOwnStockSummary } = await import('@/lib/reports')
    const { printer, azul, mosquetao } = await createMosquetao()
    await produceMosquetao(mosquetao, printer, azul, 10)

    const chaveiro = await createChaveiro('Chaveiro Café', printer, azul)
    await addProductComponentUsage(fd({ productId: chaveiro.id, componentProductId: mosquetao.id, quantity: '2' }))

    const beforeSummary = await getOwnStockSummary()
    const mosquetaoBefore = beforeSummary.find((r) => r.productId === mosquetao.id)!
    expect(mosquetaoBefore.available).toBe(10)
    expect(mosquetaoBefore.consumedAsComponent).toBe(0)

    // Monta 3 Chaveiros Café -- consome 3*2=6 Mosquetões.
    const confirm = await confirmAssembly(fd({
      productId: chaveiro.id,
      quantity: '3',
      notes: '',
      colorChoicesJson: JSON.stringify({ [mosquetao.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(confirm.success).toBe(true)

    const afterSummary = await getOwnStockSummary()
    const mosquetaoAfter = afterSummary.find((r) => r.productId === mosquetao.id)!
    expect(mosquetaoAfter.consumedAsComponent).toBe(6)
    expect(mosquetaoAfter.available).toBe(10 - 6)
  })
})

describe('Produto-como-componente: bloqueios e validações', () => {
  it('falta de componente-produto BLOQUEIA a montagem, mesma severidade de falta de peça', async () => {
    const { printer, azul, mosquetao } = await createMosquetao()
    // Só produz 2 Mosquetões.
    await produceMosquetao(mosquetao, printer, azul, 2)

    const chaveiro = await createChaveiro('Chaveiro Café', printer, azul)
    await addProductComponentUsage(fd({ productId: chaveiro.id, componentProductId: mosquetao.id, quantity: '1' }))

    // Tenta montar 5 -- só tem 2 Mosquetões.
    const result = await confirmAssembly(fd({
      productId: chaveiro.id,
      quantity: '5',
      notes: '',
      colorChoicesJson: JSON.stringify({ [mosquetao.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('Mosquetão')

    // Nada foi gravado.
    const assemblies = await prisma.productAssembly.findMany({ where: { productId: chaveiro.id } })
    expect(assemblies).toHaveLength(0)
  })

  it('rejeita self-reference (produto usando a si mesmo como componente)', async () => {
    const { printer, azul } = await createMosquetao()
    const parent = await createChaveiro('Produto pai', printer, azul)

    const result = await addProductComponentUsage(fd({ productId: parent.id, componentProductId: parent.id, quantity: '1' }))
    expect(result.success).toBe(false)

    expect(await prisma.productComponentUsage.findMany()).toHaveLength(0)
  })

  it('rejeita usar um produto composto como componente (restrição desta rodada)', async () => {
    const { printer, azul } = await createMosquetao()
    const compositeCandidate = await createChaveiro('Produto composto', printer, azul)
    const parent = await createChaveiro('Produto pai', printer, azul)

    const result = await addProductComponentUsage(fd({ productId: parent.id, componentProductId: compositeCandidate.id, quantity: '1' }))
    expect(result.success).toBe(false)
  })

  it('rejeita produto pai não-composto tentando ter componente', async () => {
    const { printer, azul, mosquetao } = await createMosquetao()
    const simpleParent = await prisma.product.create({
      data: { name: 'Produto simples', category: 'Chaveiro', printerId: printer.id, filamentId: azul.id, weightGrams: 5, printTimeHours: 0.1, laborTimeHours: 0 },
    })

    const result = await addProductComponentUsage(fd({ productId: simpleParent.id, componentProductId: mosquetao.id, quantity: '1' }))
    expect(result.success).toBe(false)
  })

  it('removeProductComponentUsage remove o vínculo e o componente some da ficha técnica', async () => {
    const { printer, azul, mosquetao } = await createMosquetao()
    const chaveiro = await createChaveiro('Chaveiro Café', printer, azul)
    await addProductComponentUsage(fd({ productId: chaveiro.id, componentProductId: mosquetao.id, quantity: '1' }))
    const usage = await prisma.productComponentUsage.findFirstOrThrow({ where: { productId: chaveiro.id } })

    const result = await removeProductComponentUsage(usage.id)
    expect(result.success).toBe(true)
    expect(await prisma.productComponentUsage.findUnique({ where: { id: usage.id } })).toBeNull()
  })
})

describe('Produto-como-componente: custo (REGRA 12/14 do pedido)', () => {
  it('getProductAverageProductionCost calcula a média ponderada do costSnapshot.total das produções, e cai pro custo da ficha técnica se nunca produzido', async () => {
    const { printer, azul, rosa, mosquetao } = await createMosquetao()

    // Bug "componente vai zerado": nunca produzido não é mais 0 -- cai pro
    // custo teórico ao vivo da própria ficha técnica (mesmo valor do card
    // dele em /products), pra não parecer "grátis" antes da 1ª produção.
    const theoreticalCost = (await getProductCostBreakdown(mosquetao.id)).finalCost
    expect(theoreticalCost).toBeGreaterThan(0)
    expect(await getProductAverageProductionCost(mosquetao.id)).toBeCloseTo(theoreticalCost, 6)

    await produceMosquetao(mosquetao, printer, azul, 5)
    await produceMosquetao(mosquetao, printer, rosa, 3)

    const runs = await prisma.productionRun.findMany({ where: { productId: mosquetao.id } })
    const totalCost = runs.reduce((sum, r) => sum + ((r.costSnapshot as any)?.total ?? 0), 0)
    const totalUnits = runs.reduce((sum, r) => sum + r.quantitySuccess, 0)
    const expectedAvg = totalCost / totalUnits

    expect(await getProductAverageProductionCost(mosquetao.id)).toBeCloseTo(expectedAvg, 6)
  })

  it('getProductCostBreakdown de um produto composto inclui componentProductsCost (quantidade × custo médio do componente)', async () => {
    const { printer, azul, mosquetao } = await createMosquetao()
    await produceMosquetao(mosquetao, printer, azul, 5)
    const avgCost = await getProductAverageProductionCost(mosquetao.id)
    expect(avgCost).toBeGreaterThan(0)

    const chaveiro = await createChaveiro('Chaveiro Café', printer, azul)
    await addProductComponentUsage(fd({ productId: chaveiro.id, componentProductId: mosquetao.id, quantity: '3' }))

    const breakdown = await getProductCostBreakdown(chaveiro.id)
    expect(breakdown.componentProductsCost).toBeCloseTo(3 * avgCost, 6)
  })

  it('ProductAssembly.costSnapshot congela o custo do componente no momento da montagem (nunca recalculado depois)', async () => {
    const { printer, azul, mosquetao } = await createMosquetao()
    await produceMosquetao(mosquetao, printer, azul, 10)
    const avgCostAtAssemblyTime = await getProductAverageProductionCost(mosquetao.id)

    const chaveiro = await createChaveiro('Chaveiro Café', printer, azul)
    await addProductComponentUsage(fd({ productId: chaveiro.id, componentProductId: mosquetao.id, quantity: '2' }))

    await confirmAssembly(fd({
      productId: chaveiro.id,
      quantity: '3',
      notes: '',
      colorChoicesJson: JSON.stringify({ [mosquetao.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))

    const assembly = await prisma.productAssembly.findFirstOrThrow({ where: { productId: chaveiro.id } })
    const snapshot = assembly.costSnapshot as any
    expect(snapshot.componentProductsCost).toBeCloseTo(3 * 2 * avgCostAtAssemblyTime, 6)

    // Produz MAIS Mosquetão depois (isso mudaria a média futura) -- o
    // snapshot já gravado não pode mudar retroativamente.
    await produceMosquetao(mosquetao, printer, azul, 100)
    const assemblyReread = await prisma.productAssembly.findUniqueOrThrow({ where: { id: assembly.id } })
    expect((assemblyReread.costSnapshot as any).componentProductsCost).toBeCloseTo(3 * 2 * avgCostAtAssemblyTime, 6)
  })
})
