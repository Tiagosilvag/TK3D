'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { calculatePrinterDepreciationCostPerHour } from '@/lib/costing'
import { quickCalcProductSchema } from '@/lib/validation/quickCalculator'

type ActionResult = { success: boolean; error?: string }

export interface QuickCalcPrinterOption {
  id: string
  name: string
  costPerHour: number
}

export interface QuickCalcFilamentOption {
  id: string
  name: string
  pricePerGram: number
  colorHex: string | null
}

export interface QuickCalcSupplyOption {
  id: string
  name: string
  unit: string
  unitCost: number
  defaultUsage: number | null
}

export interface QuickCalcAccessoryOption {
  id: string
  name: string
  unitCost: number
}

export interface QuickCalculatorData {
  laborCostPerHour: number
  defaultLaborTimeHours: number
  averagePrinterCostPerHour: number
  printers: QuickCalcPrinterOption[]
  filaments: QuickCalcFilamentOption[]
  supplies: QuickCalcSupplyOption[]
  accessories: QuickCalcAccessoryOption[]
  categories: string[]
}

// Dados pra tela da calculadora rápida (components/QuickCostCalculatorDrawer.tsx)
// -- buscado sob demanda quando a gaveta abre (não no layout, que persiste
// entre navegações e deixaria os dados obsoletos depois de qualquer edição
// de catálogo feita em outra aba/sessão).
export async function getQuickCalculatorData(): Promise<QuickCalculatorData> {
  const [settings, printers, filaments, supplies, accessories, productCategories] = await Promise.all([
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { currentStockGrams: { gt: 0 } }, orderBy: { manufacturer: 'asc' } }),
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, select: { category: true }, distinct: ['category'] }),
  ])

  const printerOptions: QuickCalcPrinterOption[] = printers.map((p) => ({
    id: p.id,
    name: p.name,
    costPerHour:
      calculatePrinterDepreciationCostPerHour({ purchasePrice: p.purchasePrice.toNumber(), depreciationHours: p.depreciationHours.toNumber() }) +
      p.maintenanceCostPerHour.toNumber() +
      p.avgPowerConsumptionKwh.toNumber() * p.energyCostPerKwh.toNumber(),
  }))

  const averagePrinterCostPerHour = printerOptions.length > 0 ? printerOptions.reduce((sum, p) => sum + p.costPerHour, 0) / printerOptions.length : 0

  return {
    laborCostPerHour: settings.laborCostPerHour.toNumber(),
    // Mesmo default de produto novo via ProductForm (ver comentário em
    // lib/validation/product.ts#laborTimeHours) -- consistência entre as
    // duas formas de cadastrar produto.
    defaultLaborTimeHours: 5 / 60,
    averagePrinterCostPerHour,
    printers: printerOptions,
    filaments: filaments.map((f) => ({
      id: f.id,
      name: `${f.manufacturer} ${f.colorName} (${f.material})`,
      pricePerGram: f.avgUnitCostPerGram.toNumber(),
      colorHex: f.colorHex,
    })),
    supplies: supplies.map((s) => ({
      id: s.id,
      name: s.name,
      unit: s.unit,
      unitCost: s.avgUnitCost.toNumber(),
      defaultUsage: s.defaultUsage?.toNumber() ?? null,
    })),
    accessories: accessories.map((a) => ({
      id: a.id,
      name: a.colorName ? `${a.name} (${a.colorName})` : a.name,
      unitCost: a.avgUnitCost.toNumber(),
    })),
    categories: productCategories.map((c) => c.category).sort(),
  }
}

const AVERAGE_PRINTER_NAME = 'Impressora Média'

// Get-or-create idempotente: "Impressora Média" é uma Printer real (visível
// em /printers como qualquer outra), com os campos de custo calculados como
// a média simples das impressoras ativas já cadastradas no momento em que
// ela é criada pela 1ª vez -- não recalculada depois disso (mesmo
// Printer.id reutilizado em toda chamada seguinte). Pedido do usuário:
// usada como valor padrão não-bloqueante pro campo Impressora do mini-
// formulário "Cadastrar como produto", sempre editável pra uma impressora
// real específica.
async function getOrCreateAveragePrinter(): Promise<{ id: string } | null> {
  const existing = await prisma.printer.findUnique({ where: { name: AVERAGE_PRINTER_NAME } })
  if (existing) return { id: existing.id }

  const printers = await prisma.printer.findMany({ where: { active: true } })
  if (printers.length === 0) return null

  const avg = (pick: (p: (typeof printers)[number]) => number) => printers.reduce((sum, p) => sum + pick(p), 0) / printers.length

  const created = await prisma.printer.create({
    data: {
      name: AVERAGE_PRINTER_NAME,
      nickname: 'Calculada automaticamente (calculadora rápida)',
      purchasePrice: avg((p) => p.purchasePrice.toNumber()),
      depreciationHours: avg((p) => p.depreciationHours.toNumber()),
      avgPowerConsumptionKwh: avg((p) => p.avgPowerConsumptionKwh.toNumber()),
      energyCostPerKwh: avg((p) => p.energyCostPerKwh.toNumber()),
      maintenanceCostPerHour: avg((p) => p.maintenanceCostPerHour.toNumber()),
    },
  })
  revalidatePath('/printers')
  return { id: created.id }
}

// "Cadastrar como produto": persiste um Product de verdade a partir do que a
// calculadora rápida já tem calculado -- mesmas tabelas que createProduct
// (actions/products.ts) grava, só que a partir de um input já achatado (sem
// FormData). Com 1 filamento só vira um Product simples, como sempre; com
// 2+ componentes (impressão multi-material, ex.: corpo preto 15g + detalhe
// verde 8g na mesma peça) vira um Product composto com uma ÚNICA ProductPart
// multi-filamento (quantityPerUnit=1) -- mesmo caso degenerado que
// lib/products.ts#productAutoAssembles já reconhece (peça que já sai pronta
// da impressora, sem nada físico pra montar): sem insumo/acessório anexado,
// actions/productionRuns.ts confirma a montagem sozinha a cada produção,
// sem exigir clique manual em /assembly.
export async function createProductFromQuickCalc(input: unknown): Promise<ActionResult & { productId?: string }> {
  const parsed = quickCalcProductSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const data = parsed.data

  let printerId = data.printerId
  if (!printerId) {
    const avgPrinter = await getOrCreateAveragePrinter()
    if (!avgPrinter) return { success: false, error: 'Cadastre ao menos uma impressora antes de criar um produto.' }
    printerId = avgPrinter.id
  }

  const isMultiFilament = data.filamentComponents.length > 1
  const totalWeightGrams = data.filamentComponents.reduce((sum, c) => sum + c.weightGrams, 0)

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: data.name,
        category: data.category,
        isComposite: isMultiFilament,
        printerId: printerId!,
        // Resumo derivado (CLAUDE.md "2.1 Produto composto") -- 1º
        // componente/peso total, mesma convenção de deriveCompositeAggregate
        // em actions/products.ts.
        filamentId: data.filamentComponents[0].filamentId,
        weightGrams: totalWeightGrams,
        printTimeHours: data.printTimeHours,
        laborTimeHours: data.laborTimeHours,
      },
    })
    if (isMultiFilament) {
      await tx.productPart.create({
        data: {
          productId: created.id,
          name: data.name,
          printerId: printerId!,
          printTimeHours: data.printTimeHours,
          quantityPerUnit: 1,
          filamentComponents: { create: data.filamentComponents.map((f) => ({ filamentId: f.filamentId, weightGrams: f.weightGrams })) },
        },
      })
    }
    for (const usage of data.supplyUsages) {
      await tx.productSupplyUsage.create({ data: { productId: created.id, supplyId: usage.id, quantity: usage.quantity } })
    }
    for (const usage of data.accessoryUsages) {
      await tx.productAccessoryUsage.create({ data: { productId: created.id, accessoryId: usage.id, quantity: usage.quantity } })
    }
    return created
  })

  revalidatePath('/products')
  // Ver comentário em deleteProduct (actions/products.ts, bug "produto
  // excluído continua montado") -- produto simples com insumo/acessório
  // pode precisar de montagem, por isso também revalida essas duas.
  revalidatePath('/assembly')
  revalidatePath('/stock')
  return { success: true, productId: product.id }
}
