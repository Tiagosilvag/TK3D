'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function filamentLabel(f: { manufacturer: string; colorName: string; rollNumber: number }): string {
  return `${f.manufacturer} ${f.colorName} — Rolo #${String(f.rollNumber).padStart(3, '0')}`
}

// Ajuste "cor multi-filamento na montagem": disponível por COMBO de
// filamentos, calculado a partir do que cada lote de produção realmente
// usou (ProductionRunFilamentUsage quando a peça é multi-filamento,
// senão só o ProductionRun.filamentId escalar) -- não da contagem de
// componentes na ficha técnica ATUAL da peça. Isso cobre tanto peça de 1
// cor só (combo de 1 filamento) quanto peça multi-filamento cuja
// combinação de cores muda de lote pra lote (combo de N filamentos,
// ex.: TAMPA marrom+rosa num lote, roxo+lavanda no lote seguinte) -- a
// suposição antiga de que "peça com 2+ componentes é sempre a mesma
// combinação fixa" não se sustentava na prática. `key` é os filamentIds
// do combo ordenados e unidos por vírgula -- estável, usado como valor
// de <option> e gravado em ProductAssembly.colorChoices; pra peça de 1
// filamento é literalmente o filamentId sozinho, então montagem
// registrada antes desse ajuste continua lendo certo sem migração.
export interface AssemblyPartColorOption {
  key: string
  filamentIds: string[]
  label: string
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

// Ajuste "produção → montagem → estoque": insumo/acessório cadastrado na
// ficha técnica do produto (composto OU simples) -- disponível em estoque
// AGORA, pra travar quantas unidades dá pra montar junto com as peças.
export interface AssemblyResourceRequirement {
  id: string
  name: string
  quantityPerUnit: number
  available: number
  unit?: string
}

export interface AssemblyStatus {
  productId: string
  productName: string
  isComposite: boolean
  parts: AssemblyPartStatus[]
  accessoryRequirements: AssemblyResourceRequirement[]
  supplyRequirements: AssemblyResourceRequirement[]
  maxAssemblableUnits: number
}

// 2.3: pra cada peça do produto, "disponível" = soma de tudo que já foi
// produzido com sucesso pra ela (ProductionRun.productPartId) menos o que
// já foi consumido em montagens anteriores (ProductAssembly.quantity ×
// quantityPerUnit dessa peça -- toda montagem consome as peças na mesma
// proporção da ficha técnica, spec 2.1). maxAssemblableUnits é o quanto dá
// pra montar AGORA, travado pela peça (ou insumo/acessório) mais escasso.
//
// Ajuste "produção → montagem → estoque": um produto SIMPLES (sem
// ProductPart nenhuma) que tenha insumo/acessório cadastrado também
// precisa passar por aqui -- ele vira uma "peça sintética" única (o
// próprio produto impresso, produzido via ProductionRun direto), sem cor
// variável (isso é conceito só de ProductPart de produto composto).
export async function getAssemblyStatus(productId: string): Promise<AssemblyStatus> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: {
      parts: true,
      assemblies: true,
      accessoryUsages: { include: { accessory: true } },
      supplyUsages: { include: { supply: true } },
    },
  })

  const alreadyAssembled = product.assemblies.reduce((sum, a) => sum + a.quantity, 0)

  let parts: AssemblyPartStatus[]

  if (product.isComposite) {
    const partIds = product.parts.map((p) => p.id)
    const producedByPart = await prisma.productionRun.groupBy({
      by: ['productPartId'],
      where: { productPartId: { in: partIds }, status: { not: 'CANCELADA' } },
      _sum: { quantitySuccess: true },
    })
    const producedMap = new Map(producedByPart.map((p) => [p.productPartId as string, p._sum.quantitySuccess ?? 0]))

    function comboKey(filamentIds: string[]): string {
      return [...new Set(filamentIds)].sort().join(',')
    }

    // Disponível por combo: cada lote de produção dessa peça contribui
    // pro combo que ele REALMENTE usou (ProductionRunFilamentUsage se a
    // peça é multi-filamento, senão só o filamentId escalar do run) --
    // não pelo que a ficha técnica diz agora, já que a receita pode ter
    // mudado desde então.
    const runs = await prisma.productionRun.findMany({
      where: { productPartId: { in: partIds }, status: { not: 'CANCELADA' } },
      select: { productPartId: true, filamentId: true, quantitySuccess: true, filamentUsages: { select: { filamentId: true } } },
    })
    const producedByPartAndCombo = new Map<string, Map<string, { filamentIds: string[]; quantity: number }>>()
    for (const run of runs) {
      const partId = run.productPartId as string
      const ids = run.filamentUsages.length > 0 ? run.filamentUsages.map((u) => u.filamentId) : [run.filamentId]
      const key = comboKey(ids)
      const byCombo = producedByPartAndCombo.get(partId) ?? new Map<string, { filamentIds: string[]; quantity: number }>()
      const entry = byCombo.get(key) ?? { filamentIds: key.split(','), quantity: 0 }
      entry.quantity += run.quantitySuccess
      byCombo.set(key, entry)
      producedByPartAndCombo.set(partId, byCombo)
    }

    // Consumido por combo: soma quantity×quantityPerUnit de cada montagem
    // anterior que registrou colorChoices pra esta peça (chave gravada =
    // comboKey, compatível com o registro antigo de peça de 1 filamento
    // só, que já era literalmente o filamentId sozinho). Montagem de
    // antes desse ajuste (colorChoices nulo) não sabe dizer qual combo
    // consumiu -- fica de fora da conta por combo, mas nunca afeta o
    // `available` total acima (que soma tudo, sem distinguir combo).
    const consumedByPartAndCombo = new Map<string, Map<string, number>>()
    for (const a of product.assemblies) {
      const choices = a.colorChoices as Record<string, string> | null
      if (!choices) continue
      for (const [partId, rawKey] of Object.entries(choices)) {
        const part = product.parts.find((p) => p.id === partId)
        if (!part) continue
        const key = comboKey(rawKey.split(','))
        const byCombo = consumedByPartAndCombo.get(partId) ?? new Map<string, number>()
        byCombo.set(key, (byCombo.get(key) ?? 0) + a.quantity * part.quantityPerUnit)
        consumedByPartAndCombo.set(partId, byCombo)
      }
    }

    const allFilamentIds = new Set<string>()
    for (const byCombo of producedByPartAndCombo.values()) for (const e of byCombo.values()) for (const id of e.filamentIds) allFilamentIds.add(id)
    const filaments = allFilamentIds.size > 0
      ? await prisma.filament.findMany({ where: { id: { in: [...allFilamentIds] } } })
      : []
    const filamentById = new Map(filaments.map((f) => [f.id, f]))

    parts = product.parts.map((part) => {
      const produced = producedMap.get(part.id) ?? 0
      const consumed = alreadyAssembled * part.quantityPerUnit
      const available = produced - consumed

      const producedByCombo = producedByPartAndCombo.get(part.id) ?? new Map<string, { filamentIds: string[]; quantity: number }>()
      const consumedByCombo = consumedByPartAndCombo.get(part.id) ?? new Map<string, number>()
      const comboKeys = new Set([...producedByCombo.keys(), ...consumedByCombo.keys()])
      const colorOptions: AssemblyPartColorOption[] = Array.from(comboKeys).map((key) => {
        const filamentIds = producedByCombo.get(key)?.filamentIds ?? key.split(',')
        const label = filamentIds.map((id) => { const f = filamentById.get(id); return f ? filamentLabel(f) : id }).join(' + ')
        return {
          key,
          filamentIds,
          label,
          available: (producedByCombo.get(key)?.quantity ?? 0) - (consumedByCombo.get(key) ?? 0),
        }
      })

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
  } else {
    // Produto simples que precisa de montagem (tem insumo/acessório
    // cadastrado): uma única "peça sintética" = o produto impresso em si.
    const producedAgg = await prisma.productionRun.aggregate({
      where: { productId, productPartId: null, status: { not: 'CANCELADA' } },
      _sum: { quantitySuccess: true },
    })
    const produced = producedAgg._sum.quantitySuccess ?? 0
    const consumed = alreadyAssembled
    const available = produced - consumed
    parts = [
      {
        partId: product.id,
        name: product.name,
        quantityPerUnit: 1,
        produced,
        consumed,
        available,
        maxUnitsFromThisPart: available,
        colorOptions: null,
      },
    ]
  }

  const accessoryRequirements: AssemblyResourceRequirement[] = product.accessoryUsages.map((u) => ({
    id: u.accessoryId,
    name: u.accessory.colorName ? `${u.accessory.name} — ${u.accessory.colorName}` : u.accessory.name,
    quantityPerUnit: u.quantity.toNumber(),
    available: u.accessory.currentStock.toNumber(),
  }))
  const supplyRequirements: AssemblyResourceRequirement[] = product.supplyUsages.map((u) => ({
    id: u.supplyId,
    name: u.supply.name,
    quantityPerUnit: u.quantity.toNumber(),
    available: u.supply.currentStock.toNumber(),
    unit: u.supply.unit,
  }))

  const limits = [
    ...parts.map((p) => p.maxUnitsFromThisPart),
    ...accessoryRequirements.map((r) => Math.floor(r.available / r.quantityPerUnit)),
    ...supplyRequirements.map((r) => Math.floor(r.available / r.quantityPerUnit)),
  ]
  const maxAssemblableUnits = limits.length === 0 ? 0 : Math.max(0, Math.min(...limits))

  return {
    productId: product.id,
    productName: product.name,
    isComposite: product.isComposite,
    parts,
    accessoryRequirements,
    supplyRequirements,
    maxAssemblableUnits,
  }
}

const confirmAssemblySchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  notes: z.string().optional().nullable(),
})

const resourceUsageSchema = z.object({
  id: z.string().min(1),
  quantityPerUnit: z.coerce.number().nonnegative(),
})

// Confirma a montagem: valida de novo (contra corrida com outra montagem
// simultânea) que cada peça e cada insumo/acessório ainda tem estoque
// suficiente e só então grava o ProductAssembly + dá baixa em tudo -- não
// há contador físico separado pra peça/produto acabado, "dar baixa nas
// peças" e "somar ao estoque do produto acabado" são os dois lados do
// mesmo cálculo derivado (lib/reports.ts#getOwnStockSummary e
// getAssemblyStatus acima leem esta mesma tabela).
//
// Ajuste "cor na montagem": pra cada peça com colorOptions (cor variável),
// o formulário manda qual cor foi escolhida (colorChoicesJson) -- valida
// contra o `available` DAQUELA cor especificamente.
//
// Ajuste "produção → montagem → estoque": insumo/acessório NUNCA eram
// decrementados em lugar nenhum pra produto composto (só entravam no
// custo, nunca no estoque) -- agora são decrementados aqui, pra composto
// E pra simples-com-componente. A lista vem do formulário (accessoryUsagesJson/
// supplyUsagesJson), pré-preenchida a partir da ficha técnica do produto
// mas totalmente editável pra aquela leva (adicionar linha nova, trocar,
// remover) -- não altera a ficha técnica cadastrada, só o que é consumido
// nesta montagem específica.
export async function confirmAssembly(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  const parsed = confirmAssemblySchema.safeParse({ ...raw, notes: raw.notes || null })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { productId, quantity, notes } = parsed.data

  function parseJsonArray(value: FormDataEntryValue | undefined): unknown[] {
    if (!value) return []
    try {
      const result = JSON.parse(String(value))
      return Array.isArray(result) ? result : []
    } catch {
      return []
    }
  }

  const submittedColorChoices: Record<string, string> = raw.colorChoicesJson
    ? (() => {
        try {
          return JSON.parse(String(raw.colorChoicesJson))
        } catch {
          return {}
        }
      })()
    : {}
  const submittedAccessoryUsages = parseJsonArray(raw.accessoryUsagesJson)
    .map((u) => resourceUsageSchema.safeParse(u))
    .filter((r): r is { success: true; data: z.infer<typeof resourceUsageSchema> } => r.success)
    .map((r) => r.data)
  const submittedSupplyUsages = parseJsonArray(raw.supplyUsagesJson)
    .map((u) => resourceUsageSchema.safeParse(u))
    .filter((r): r is { success: true; data: z.infer<typeof resourceUsageSchema> } => r.success)
    .map((r) => r.data)

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
    const chosenKey = submittedColorChoices[part.partId]
    const chosenOption = part.colorOptions.find((o) => o.key === chosenKey)
    if (!chosenOption) {
      insufficient.push(`${part.name} (selecione a cor)`)
      continue
    }
    const maxUnitsForColor = Math.floor(chosenOption.available / part.quantityPerUnit)
    if (maxUnitsForColor < quantity) {
      insufficient.push(`${part.name} ${chosenOption.label} (dá pra montar só ${maxUnitsForColor})`)
      continue
    }
    colorChoicesToStore[part.partId] = chosenKey
  }

  // Revalida insumo/acessório contra o estoque ATUAL (não o já carregado
  // em `status`, pra evitar corrida com outra montagem/reposição
  // simultânea) -- a lista é editável nesta leva, então busca de novo
  // pelos ids realmente submetidos, não pelos da ficha técnica.
  const accessoryIds = [...new Set(submittedAccessoryUsages.map((u) => u.id))]
  const supplyIds = [...new Set(submittedSupplyUsages.map((u) => u.id))]
  const [accessories, supplies] = await Promise.all([
    accessoryIds.length > 0 ? prisma.accessory.findMany({ where: { id: { in: accessoryIds } } }) : Promise.resolve([]),
    supplyIds.length > 0 ? prisma.supply.findMany({ where: { id: { in: supplyIds } } }) : Promise.resolve([]),
  ])
  const accessoryById = new Map(accessories.map((a) => [a.id, a]))
  const supplyById = new Map(supplies.map((s) => [s.id, s]))

  const accessoryConsumption: { accessoryId: string; quantity: number }[] = []
  for (const u of submittedAccessoryUsages) {
    if (u.quantityPerUnit <= 0) continue
    const accessory = accessoryById.get(u.id)
    if (!accessory) continue
    const needed = u.quantityPerUnit * quantity
    const available = accessory.currentStock.toNumber()
    if (needed > available) {
      insufficient.push(`${accessory.name} (necessário ${needed}, disponível ${available})`)
    } else {
      accessoryConsumption.push({ accessoryId: u.id, quantity: needed })
    }
  }
  const supplyConsumption: { supplyId: string; quantity: number }[] = []
  for (const u of submittedSupplyUsages) {
    if (u.quantityPerUnit <= 0) continue
    const supply = supplyById.get(u.id)
    if (!supply) continue
    const needed = u.quantityPerUnit * quantity
    const available = supply.currentStock.toNumber()
    if (needed > available) {
      insufficient.push(`${supply.name} (necessário ${needed}, disponível ${available})`)
    } else {
      supplyConsumption.push({ supplyId: u.id, quantity: needed })
    }
  }

  if (insufficient.length > 0) {
    return { success: false, error: `Estoque insuficiente: ${insufficient.join('; ')}` }
  }

  await prisma.$transaction([
    prisma.productAssembly.create({
      data: {
        productId,
        quantity,
        notes,
        colorChoices: Object.keys(colorChoicesToStore).length > 0 ? colorChoicesToStore : undefined,
      },
    }),
    ...accessoryConsumption.map((c) =>
      prisma.accessory.update({ where: { id: c.accessoryId }, data: { currentStock: { decrement: c.quantity } } }),
    ),
    ...supplyConsumption.map((c) =>
      prisma.supply.update({ where: { id: c.supplyId }, data: { currentStock: { decrement: c.quantity } } }),
    ),
  ])

  revalidatePath('/assembly')
  revalidatePath('/stock')
  revalidatePath('/accessories')
  revalidatePath('/supplies')
  return { success: true }
}
