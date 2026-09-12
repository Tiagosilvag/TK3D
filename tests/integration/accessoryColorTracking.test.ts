import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { confirmAssembly, getAssemblyStatus, updateAssemblyColorChoices } from '@/actions/assembly'
import { getProductVariantBreakdown } from '@/lib/reports'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.stockConsumption.deleteMany()
  await prisma.productAssembly.deleteMany()
  await prisma.productionRun.deleteMany()
  await prisma.productComponentUsage.deleteMany()
  await prisma.productAccessoryUsage.deleteMany()
  await prisma.productPartFilament.deleteMany()
  await prisma.productPart.deleteMany()
  await prisma.product.deleteMany()
  await prisma.accessoryPurchase.deleteMany()
  await prisma.accessory.deleteMany({ where: { name: 'Corrente Bolinha' } })
  await prisma.accessoryTypeRecord.deleteMany({ where: { name: 'Corrente Teste' } })
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

// Cenário do bug relatado: produto simples ("peça sintética", precisa de
// montagem por ter acessório cadastrado) cujo acessório tem 2 cores no
// catálogo -- Corrente Bolinha Prata/Dourada.
async function buildProductWithColorVariableAccessory() {
  const printer = await prisma.printer.create({ data: { name: 'P1', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
  const filament = await prisma.filament.create({ data: { manufacturer: 'F1', material: 'PLA', colorName: 'Vermelho', colorHex: '#ff0000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
  const type = await prisma.accessoryTypeRecord.create({ data: { name: 'Corrente Teste' } })
  const prata = await prisma.accessory.create({ data: { name: 'Corrente Bolinha', type: type.id, colorName: 'Prata', currentStock: 20, avgUnitCost: 0.3 } })
  const dourada = await prisma.accessory.create({ data: { name: 'Corrente Bolinha', type: type.id, colorName: 'Dourada', currentStock: 20, avgUnitCost: 0.3 } })

  const product = await prisma.product.create({
    data: {
      name: 'Mini Spiderman Flexi Teste', category: 'Chaveiro',
      printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 0.5, laborTimeHours: 0,
      accessoryUsages: { create: [{ accessoryId: prata.id, quantity: 1 }] },
    },
  })

  await prisma.productionRun.create({
    data: { batchId: 'b1', productId: product.id, printerId: printer.id, filamentId: filament.id, date: new Date('2026-09-01'), quantityPlanned: 14, quantitySuccess: 14, quantityFailed: 0, gramsUsed: 140, gramsWasted: 0, timeWastedHours: 0 },
  })

  return { printer, filament, type, prata, dourada, product }
}

describe('Acessório com cor variável rastreado por leva de montagem', () => {
  it('getAssemblyStatus expõe colorOptions com os 2 irmãos de cor pro acessório', async () => {
    const { prata, dourada, product } = await buildProductWithColorVariableAccessory()
    const status = await getAssemblyStatus(product.id)
    const requirement = status.accessoryRequirements.find((r) => r.id === prata.id)!
    expect(requirement.colorOptions).not.toBeNull()
    expect(requirement.colorOptions).toHaveLength(2)
    const keys = requirement.colorOptions!.map((o) => o.key).sort()
    expect(keys).toEqual([dourada.id, prata.id].sort())
    const prataOption = requirement.colorOptions!.find((o) => o.key === prata.id)!
    expect(prataOption.available).toBe(20)
    expect(prataOption.label).toBe('Corrente Bolinha — Prata')
  })

  it('2 confirmações com cores de acessório diferentes viram 2 variações distintas no Estoque, cada uma com a quantidade certa', async () => {
    const { filament, prata, dourada, product } = await buildProductWithColorVariableAccessory()

    const confirm1 = await confirmAssembly(fd({
      productId: product.id,
      quantity: '7',
      notes: '',
      colorChoicesJson: JSON.stringify({ [product.id]: filament.id, [prata.id]: prata.id }),
      accessoryUsagesJson: JSON.stringify([{ id: prata.id, quantityPerUnit: 1 }]),
      supplyUsagesJson: '[]',
    }))
    expect(confirm1.success).toBe(true)

    const confirm2 = await confirmAssembly(fd({
      productId: product.id,
      quantity: '7',
      notes: '',
      colorChoicesJson: JSON.stringify({ [product.id]: filament.id, [prata.id]: dourada.id }),
      accessoryUsagesJson: JSON.stringify([{ id: dourada.id, quantityPerUnit: 1 }]),
      supplyUsagesJson: '[]',
    }))
    expect(confirm2.success).toBe(true)

    const breakdown = await getProductVariantBreakdown(product.id, true)
    expect(breakdown).toHaveLength(2)

    const prataVariant = breakdown.find((v) => v.label.includes('Prata'))!
    expect(prataVariant.quantity).toBe(7)
    const douradaVariant = breakdown.find((v) => v.label.includes('Dourada'))!
    expect(douradaVariant.quantity).toBe(7)

    const [prataAfter, douradaAfter] = await Promise.all([
      prisma.accessory.findUniqueOrThrow({ where: { id: prata.id } }),
      prisma.accessory.findUniqueOrThrow({ where: { id: dourada.id } }),
    ])
    expect(prataAfter.currentStock.toNumber()).toBe(13)
    expect(douradaAfter.currentStock.toNumber()).toBe(13)
  })

  it('acessório sem irmão de cor continua funcionando exatamente como antes (colorOptions null, sem exigir escolha)', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P2', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const filament = await prisma.filament.create({ data: { manufacturer: 'F2', material: 'PLA', colorName: 'Preto', colorHex: '#000000', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const type = await prisma.accessoryTypeRecord.create({ data: { name: 'Corrente Teste' } })
    const unica = await prisma.accessory.create({ data: { name: 'Corrente Bolinha', type: type.id, colorName: '', currentStock: 10, avgUnitCost: 0.3 } })
    const product = await prisma.product.create({
      data: {
        name: 'Produto Sem Cor Teste', category: 'Chaveiro',
        printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 0.5, laborTimeHours: 0,
        accessoryUsages: { create: [{ accessoryId: unica.id, quantity: 1 }] },
      },
    })
    await prisma.productionRun.create({
      data: { batchId: 'b1', productId: product.id, printerId: printer.id, filamentId: filament.id, date: new Date('2026-09-01'), quantityPlanned: 5, quantitySuccess: 5, quantityFailed: 0, gramsUsed: 50, gramsWasted: 0, timeWastedHours: 0 },
    })

    const status = await getAssemblyStatus(product.id)
    const requirement = status.accessoryRequirements.find((r) => r.id === unica.id)!
    expect(requirement.colorOptions).toBeNull()

    const confirm = await confirmAssembly(fd({
      productId: product.id,
      quantity: '5',
      notes: '',
      colorChoicesJson: JSON.stringify({ [product.id]: filament.id }),
      accessoryUsagesJson: JSON.stringify([{ id: unica.id, quantityPerUnit: 1 }]),
      supplyUsagesJson: '[]',
    }))
    expect(confirm.success).toBe(true)
  })
})

describe('Bug "VERMELHO solto": label de produto-como-componente ganha o prefixo do nome', () => {
  it('getProductVariantBreakdown prefixa a cor do componente com o nome dele (ex. "Mosquetão: Azul")', async () => {
    const printer = await prisma.printer.create({ data: { name: 'P3', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 } })
    const azul = await prisma.filament.create({ data: { manufacturer: 'Voolt', material: 'PLA', colorName: 'Azul', colorHex: '#0000FF', rollNumber: 1, spoolPrice: 80, spoolWeightKg: 1, initialStockGrams: 1000, currentStockGrams: 1000 } })
    const mosquetao = await prisma.product.create({
      data: { name: 'Mosquetão', category: 'Chaveiro', printerId: printer.id, filamentId: azul.id, weightGrams: 3, printTimeHours: 0.2, laborTimeHours: 0 },
    })
    await prisma.productionRun.create({
      data: { batchId: 'b1', productId: mosquetao.id, printerId: printer.id, filamentId: azul.id, date: new Date('2026-09-01'), quantityPlanned: 10, quantitySuccess: 10, quantityFailed: 0, gramsUsed: 30, gramsWasted: 0, timeWastedHours: 0 },
    })

    const chaveiro = await prisma.product.create({
      data: {
        name: 'Chaveiro Com Componente Teste', category: 'Chaveiro', isComposite: true,
        printerId: printer.id, filamentId: azul.id, weightGrams: 0, printTimeHours: 0, laborTimeHours: 0,
        componentUsages: { create: [{ componentProductId: mosquetao.id, quantity: 1 }] },
      },
    })

    const confirm = await confirmAssembly(fd({
      productId: chaveiro.id,
      quantity: '3',
      notes: '',
      colorChoicesJson: JSON.stringify({ [mosquetao.id]: azul.id }),
      accessoryUsagesJson: '[]',
      supplyUsagesJson: '[]',
    }))
    expect(confirm.success).toBe(true)

    const breakdown = await getProductVariantBreakdown(chaveiro.id, true)
    expect(breakdown).toHaveLength(1)
    expect(breakdown[0].label).toBe('Mosquetão: Azul')
    expect(breakdown[0].quantity).toBe(3)
  })
})

describe('Editar variação (corrigir cor gravada errada numa leva de montagem)', () => {
  it('troca a cor do acessório de uma variação já montada -- devolve estoque da cor antiga e consome da cor nova', async () => {
    const { filament, prata, dourada, product } = await buildProductWithColorVariableAccessory()

    const confirm = await confirmAssembly(fd({
      productId: product.id,
      quantity: '7',
      notes: '',
      colorChoicesJson: JSON.stringify({ [product.id]: filament.id, [prata.id]: prata.id }),
      accessoryUsagesJson: JSON.stringify([{ id: prata.id, quantityPerUnit: 1 }]),
      supplyUsagesJson: '[]',
    }))
    expect(confirm.success).toBe(true)

    const [prataAfterConfirm, douradaAfterConfirm] = await Promise.all([
      prisma.accessory.findUniqueOrThrow({ where: { id: prata.id } }),
      prisma.accessory.findUniqueOrThrow({ where: { id: dourada.id } }),
    ])
    expect(prataAfterConfirm.currentStock.toNumber()).toBe(13)
    expect(douradaAfterConfirm.currentStock.toNumber()).toBe(20)

    const breakdownBefore = await getProductVariantBreakdown(product.id, true)
    expect(breakdownBefore).toHaveLength(1)
    const wrongComboKey = breakdownBefore[0].key

    // Usuário gravou Prata sem querer -- na verdade era Dourada. A escolha
    // de filamento do produto (chave própria, cor variável de 1 opção só)
    // continua igual -- só o acessório muda, igual EditVariantColorsForm
    // manda o objeto INTEIRO (todas as chaves, só a editada com valor novo).
    const edit = await updateAssemblyColorChoices(fd({
      productId: product.id,
      oldComboKey: wrongComboKey,
      colorChoicesJson: JSON.stringify({ [product.id]: filament.id, [prata.id]: dourada.id }),
    }))
    expect(edit.success).toBe(true)

    const breakdownAfter = await getProductVariantBreakdown(product.id, true)
    expect(breakdownAfter).toHaveLength(1)
    expect(breakdownAfter[0].label).toContain('Dourada')
    expect(breakdownAfter[0].quantity).toBe(7)

    // Estoque físico se move de verdade: Prata volta a 20 (os 7 usados por
    // engano voltam), Dourada cai pra 13 (os 7 realmente usados saem dela).
    const [prataAfterEdit, douradaAfterEdit] = await Promise.all([
      prisma.accessory.findUniqueOrThrow({ where: { id: prata.id } }),
      prisma.accessory.findUniqueOrThrow({ where: { id: dourada.id } }),
    ])
    expect(prataAfterEdit.currentStock.toNumber()).toBe(20)
    expect(douradaAfterEdit.currentStock.toNumber()).toBe(13)

    const assembly = await prisma.productAssembly.findFirstOrThrow({ where: { productId: product.id } })
    expect(assembly.quantity).toBe(7)
    expect((assembly.colorChoices as Record<string, string>)[prata.id]).toBe(dourada.id)

    // StockConsumption também é corrigido -- passa a apontar pra cor nova,
    // senão uma reversão futura (reverseExcessAssemblyForRun) devolveria
    // estoque pra cor errada.
    const consumption = await prisma.stockConsumption.findFirstOrThrow({
      where: { resourceType: 'ACCESSORY', productId: product.id, source: 'ASSEMBLY', sourceId: assembly.id },
    })
    expect(consumption.resourceId).toBe(dourada.id)
  })

  it('bloqueia a troca se a cor nova não tem estoque suficiente -- nada é alterado (nem estoque, nem rótulo)', async () => {
    const { filament, prata, dourada, product } = await buildProductWithColorVariableAccessory()
    // Esgota Dourada quase inteira, sobrando menos do que os 7 que
    // precisariam ser transferidos pra ela na edição.
    await prisma.accessory.update({ where: { id: dourada.id }, data: { currentStock: 3 } })

    const confirm = await confirmAssembly(fd({
      productId: product.id,
      quantity: '7',
      notes: '',
      colorChoicesJson: JSON.stringify({ [product.id]: filament.id, [prata.id]: prata.id }),
      accessoryUsagesJson: JSON.stringify([{ id: prata.id, quantityPerUnit: 1 }]),
      supplyUsagesJson: '[]',
    }))
    expect(confirm.success).toBe(true)

    const breakdown = await getProductVariantBreakdown(product.id, true)
    const wrongComboKey = breakdown[0].key

    const edit = await updateAssemblyColorChoices(fd({
      productId: product.id,
      oldComboKey: wrongComboKey,
      colorChoicesJson: JSON.stringify({ [product.id]: filament.id, [prata.id]: dourada.id }),
    }))
    expect(edit.success).toBe(false)
    expect(edit.error).toContain('Dourada')

    const [prataAfter, douradaAfter] = await Promise.all([
      prisma.accessory.findUniqueOrThrow({ where: { id: prata.id } }),
      prisma.accessory.findUniqueOrThrow({ where: { id: dourada.id } }),
    ])
    expect(prataAfter.currentStock.toNumber()).toBe(13)
    expect(douradaAfter.currentStock.toNumber()).toBe(3)

    const assembly = await prisma.productAssembly.findFirstOrThrow({ where: { productId: product.id } })
    expect((assembly.colorChoices as Record<string, string>)[prata.id]).toBe(prata.id)
  })

  it('rejeita um comboKey que não bate com nenhuma montagem -- nada é alterado', async () => {
    const { filament, prata, dourada, product } = await buildProductWithColorVariableAccessory()
    await confirmAssembly(fd({
      productId: product.id,
      quantity: '7',
      notes: '',
      colorChoicesJson: JSON.stringify({ [product.id]: filament.id, [prata.id]: prata.id }),
      accessoryUsagesJson: JSON.stringify([{ id: prata.id, quantityPerUnit: 1 }]),
      supplyUsagesJson: '[]',
    }))

    const edit = await updateAssemblyColorChoices(fd({
      productId: product.id,
      oldComboKey: `${prata.id}:combo-que-nao-existe`,
      colorChoicesJson: JSON.stringify({ [prata.id]: dourada.id }),
    }))
    expect(edit.success).toBe(false)

    const assembly = await prisma.productAssembly.findFirstOrThrow({ where: { productId: product.id } })
    expect((assembly.colorChoices as Record<string, string>)[prata.id]).toBe(prata.id)
  })
})
