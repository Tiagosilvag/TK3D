'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function filamentLabel(f: { manufacturer: string; colorName: string; rollNumber: number }): string {
  return `${f.manufacturer} ${f.colorName} — Rolo #${String(f.rollNumber).padStart(3, '0')}`
}

// Ajuste "cor na montagem": disponível por cor, só faz sentido pra uma
// peça de EXATAMENTE 1 componente de filamento na receita (a cor pode
// variar de um lote de produção pro outro -- ver ProductPart.
// filamentComponents). Uma peça com receita multi-filamento fixa (2+
// componentes sempre juntos) não tem "cor variável" nenhuma pra escolher,
// então fica de fora (colorOptions null, comportamento de sempre).
export interface AssemblyPartColorOption {
  filamentId: string
  filamentLabel: string
  available: number
}

export interface AssemblyPartStatus {
  partId: string
  name: string
  quantityPerUnit: number
  produced: number
  consumed: number
  available: number
  // Quantas unidades do produto essa peça sozinha permite montar --
  // maxAssemblableUnits do produto é o mínimo entre todas as peças.
  maxUnitsFromThisPart: number
  colorOptions: AssemblyPartColorOption[] | null
}

export interface AssemblyStatus {
  productId: string
  productName: string
  parts: AssemblyPartStatus[]
  maxAssemblableUnits: number
}

// 2.3: pra cada peça do produto, "disponível" = soma de tudo que já foi
// produzido com sucesso pra ela (ProductionRun.productPartId) menos o que
// já foi consumido em montagens anteriores (ProductAssembly.quantity ×
// quantityPerUnit dessa peça -- toda montagem consome as peças na mesma
// proporção da ficha técnica, spec 2.1). maxAssemblableUnits é o quanto dá
// pra montar AGORA, travado pela peça mais escassa. Este total nunca muda
// com o ajuste "cor na montagem" abaixo -- colorOptions é só um detalhamento
// opcional por cima do mesmo número.
export async function getAssemblyStatus(productId: string): Promise<AssemblyStatus> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { parts: { include: { filamentComponents: true } }, assemblies: true },
  })

  const alreadyAssembled = product.assemblies.reduce((sum, a) => sum + a.quantity, 0)

  const producedByPart = await prisma.productionRun.groupBy({
    by: ['productPartId'],
    where: { productPartId: { in: product.parts.map((p) => p.id) }, status: { not: 'CANCELADA' } },
    _sum: { quantitySuccess: true },
  })
  const producedMap = new Map(producedByPart.map((p) => [p.productPartId as string, p._sum.quantitySuccess ?? 0]))

  const singleFilamentPartIds = product.parts.filter((p) => p.filamentComponents.length === 1).map((p) => p.id)
  const producedByPartAndColor = singleFilamentPartIds.length > 0
    ? await prisma.productionRun.groupBy({
        by: ['productPartId', 'filamentId'],
        where: { productPartId: { in: singleFilamentPartIds }, status: { not: 'CANCELADA' } },
        _sum: { quantitySuccess: true },
      })
    : []

  // Consumido por cor: soma quantity×quantityPerUnit de cada montagem
  // anterior que registrou colorChoices pra esta peça. Uma montagem de
  // antes desse ajuste (colorChoices nulo) não sabe dizer qual cor
  // consumiu -- fica de fora da conta por cor, mas nunca afeta o
  // `available` total acima (que soma tudo, sem distinguir cor).
  const consumedByPartAndColor = new Map<string, Map<string, number>>()
  for (const a of product.assemblies) {
    const choices = a.colorChoices as Record<string, string> | null
    if (!choices) continue
    for (const [partId, filamentId] of Object.entries(choices)) {
      const part = product.parts.find((p) => p.id === partId)
      if (!part) continue
      const byColor = consumedByPartAndColor.get(partId) ?? new Map<string, number>()
      byColor.set(filamentId, (byColor.get(filamentId) ?? 0) + a.quantity * part.quantityPerUnit)
      consumedByPartAndColor.set(partId, byColor)
    }
  }

  // Um único fetch pra todos os filamentos que aparecem em qualquer cor de
  // qualquer peça (a receita da peça só cita 1, mas produções reais podem
  // ter usado outro rolo da mesma cor -- ou até outra cor).
  const allColorFilamentIds = new Set<string>()
  for (const row of producedByPartAndColor) allColorFilamentIds.add(row.filamentId)
  for (const byColor of consumedByPartAndColor.values()) for (const id of byColor.keys()) allColorFilamentIds.add(id)
  const colorFilaments = allColorFilamentIds.size > 0
    ? await prisma.filament.findMany({ where: { id: { in: [...allColorFilamentIds] } } })
    : []
  const colorFilamentById = new Map(colorFilaments.map((f) => [f.id, f]))

  const parts: AssemblyPartStatus[] = product.parts.map((part) => {
    const produced = producedMap.get(part.id) ?? 0
    const consumed = alreadyAssembled * part.quantityPerUnit
    const available = produced - consumed

    let colorOptions: AssemblyPartColorOption[] | null = null
    if (part.filamentComponents.length === 1) {
      const producedByColor = new Map<string, number>()
      for (const row of producedByPartAndColor) {
        if (row.productPartId === part.id) producedByColor.set(row.filamentId, row._sum.quantitySuccess ?? 0)
      }
      const consumedByColor = consumedByPartAndColor.get(part.id) ?? new Map<string, number>()
      const colorIds = new Set([...producedByColor.keys(), ...consumedByColor.keys()])
      colorOptions = Array.from(colorIds).map((filamentId) => {
        const filament = colorFilamentById.get(filamentId)
        return {
          filamentId,
          filamentLabel: filament ? filamentLabel(filament) : filamentId,
          available: (producedByColor.get(filamentId) ?? 0) - (consumedByColor.get(filamentId) ?? 0),
        }
      })
    }

    return {
      partId: part.id,
      name: part.name,
      quantityPerUnit: part.quantityPerUnit,
      produced,
      consumed,
      available,
      maxUnitsFromThisPart: Math.floor(available / part.quantityPerUnit),
      colorOptions,
    }
  })

  const maxAssemblableUnits = parts.length === 0 ? 0 : Math.max(0, Math.min(...parts.map((p) => p.maxUnitsFromThisPart)))

  return { productId: product.id, productName: product.name, parts, maxAssemblableUnits }
}

const confirmAssemblySchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  notes: z.string().optional().nullable(),
})

// Confirma a montagem: valida de novo (contra corrida com outra montagem
// simultânea) que cada peça ainda tem estoque suficiente e só então grava
// o ProductAssembly -- não há contador físico pra decrementar em outro
// lugar, "dar baixa nas peças" e "somar ao estoque do produto acabado" são
// os dois lados do mesmo cálculo derivado (lib/reports.ts#getOwnStockSummary
// e getAssemblyStatus acima leem esta mesma tabela).
//
// Ajuste "cor na montagem": pra cada peça com colorOptions (cor variável),
// o formulário manda qual cor foi escolhida (colorChoicesJson) -- valida
// contra o `available` DAQUELA cor especificamente (não o total da peça),
// e grava a escolha em ProductAssembly.colorChoices.
export async function confirmAssembly(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  const parsed = confirmAssemblySchema.safeParse({ ...raw, notes: raw.notes || null })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { productId, quantity, notes } = parsed.data

  let submittedColorChoices: Record<string, string> = {}
  if (raw.colorChoicesJson) {
    try {
      submittedColorChoices = JSON.parse(String(raw.colorChoicesJson))
    } catch {
      submittedColorChoices = {}
    }
  }

  const status = await getAssemblyStatus(productId)

  const insufficient: string[] = []
  const colorChoicesToStore: Record<string, string> = {}
  for (const part of status.parts) {
    if (!part.colorOptions) {
      if (part.maxUnitsFromThisPart < quantity) {
        insufficient.push(`${part.name} (dá pra montar só ${part.maxUnitsFromThisPart})`)
      }
      continue
    }
    const chosenFilamentId = submittedColorChoices[part.partId]
    const chosenOption = part.colorOptions.find((o) => o.filamentId === chosenFilamentId)
    if (!chosenOption) {
      insufficient.push(`${part.name} (selecione a cor)`)
      continue
    }
    const maxUnitsForColor = Math.floor(chosenOption.available / part.quantityPerUnit)
    if (maxUnitsForColor < quantity) {
      insufficient.push(`${part.name} ${chosenOption.filamentLabel} (dá pra montar só ${maxUnitsForColor})`)
      continue
    }
    colorChoicesToStore[part.partId] = chosenFilamentId
  }
  if (insufficient.length > 0) {
    return { success: false, error: `Peças insuficientes: ${insufficient.join('; ')}` }
  }

  await prisma.productAssembly.create({
    data: {
      productId,
      quantity,
      notes,
      colorChoices: Object.keys(colorChoicesToStore).length > 0 ? colorChoicesToStore : undefined,
    },
  })

  revalidatePath('/assembly')
  revalidatePath('/stock')
  return { success: true }
}
