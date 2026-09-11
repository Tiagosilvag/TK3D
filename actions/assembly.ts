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
// próprio produto impresso, produzido via ProductionRun direto).
//
// Bug "cor no produto simples": essa peça sintética TAMBÉM tem cor
// variável, igual peça de produto composto de 1 filamento -- o produto
// pode ter sido impresso em lotes de cores diferentes (ex.: 2 unidades
// azul + 1 vermelho), e antes disso ficava escondido (agrupava tudo numa
// cor só). Mesmo tratamento por combo do caso composto abaixo, só que
// chaveado pelo id do próprio produto em vez de um productPartId (não
// existe ProductPart aqui pra servir de chave).
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
      // Nunca negativo (bug de estoque/montagem): "disponível" é produzido
      // menos já consumido em montagens -- excluir uma ProductionRun já
      // concluída (deleteProductionRun) reduz "produced" retroativamente
      // sem desfazer ProductAssembly (histórico, nunca reescrito), podendo
      // deixar esse residual negativo. Zera aqui em vez de mostrar
      // negativo; maxUnitsFromThisPart deriva deste valor já clampado.
      const available = Math.max(0, produced - consumed)

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
          available: Math.max(0, (producedByCombo.get(key)?.quantity ?? 0) - (consumedByCombo.get(key) ?? 0)),
        }
      })

      // Bug "aviso falso de estoque insuficiente": `available`/
      // `maxUnitsFromThisPart` cegos a cor (acima) descontam `consumed`
      // (todas as montagens já feitas, seja qual for a cor) de `produced`
      // (soma de todas as cores) -- se alguma montagem antiga não tem
      // colorChoices registrado (anterior a esse ajuste) OU uma
      // ProductionRun já concluída foi excluída depois de já ter sido
      // montada (deleteProductionRun não desfaz ProductAssembly, comment
      // acima), esse total pode ficar defasado/zerado mesmo com produção
      // nova, sem consumo, disponível numa cor específica. confirmAssembly
      // e ConfirmAssemblyForm já validam contra `colorOptions[].available`
      // (por combo) pra peça de cor variável, nunca contra esses dois
      // campos -- então a peça É montável de verdade mesmo quando eles
      // mostram 0. Corrige a fonte: quando há combo (colorOptions não
      // vazio), `available` vira a soma dos combos (bate com a quebra por
      // cor já exibida embaixo) e `maxUnitsFromThisPart` vira o melhor
      // combo isolado (você monta escolhendo UMA cor por leva).
      const hasColorBreakdown = colorOptions.length > 0
      const colorAwareAvailable = hasColorBreakdown
        ? colorOptions.reduce((sum, c) => sum + c.available, 0)
        : available
      const colorAwareMaxUnits = hasColorBreakdown
        ? Math.max(...colorOptions.map((c) => Math.floor(c.available / part.quantityPerUnit)))
        : Math.floor(available / part.quantityPerUnit)

      return {
        partId: part.id,
        name: part.name,
        quantityPerUnit: part.quantityPerUnit,
        produced,
        consumed,
        available: colorAwareAvailable,
        maxUnitsFromThisPart: colorAwareMaxUnits,
        colorOptions,
      }
    })
  } else {
    // Produto simples que precisa de montagem (tem insumo/acessório
    // cadastrado): uma única "peça sintética" = o produto impresso em si.
    // Bug "cor no produto simples": mesmo peça única pode ter sido
    // produzida em mais de uma cor (lotes de produção distintos com
    // filamento diferente) -- disponível por combo aqui é o mesmo
    // tratamento do caso composto acima, simplificado pra sempre 1
    // filamento (produto simples nunca tem ProductPartFilament/
    // filamentUsages, só o campo escalar ProductionRun.filamentId).
    const runs = await prisma.productionRun.findMany({
      where: { productId, productPartId: null, status: { not: 'CANCELADA' } },
      select: { filamentId: true, quantitySuccess: true },
    })
    const producedByCombo = new Map<string, number>()
    for (const run of runs) {
      producedByCombo.set(run.filamentId, (producedByCombo.get(run.filamentId) ?? 0) + run.quantitySuccess)
    }

    // Consumido por combo: colorChoices de montagens anteriores, chaveado
    // pelo próprio id do produto -- não existe ProductPart aqui pra servir
    // de chave (peça sintética), então usa o mesmo id usado como `partId`
    // abaixo (ver AssemblyStatus/confirmAssembly, que grava
    // colorChoicesToStore[part.partId]).
    const consumedByCombo = new Map<string, number>()
    for (const a of product.assemblies) {
      const choices = a.colorChoices as Record<string, string> | null
      const key = choices?.[product.id]
      if (!key) continue
      consumedByCombo.set(key, (consumedByCombo.get(key) ?? 0) + a.quantity)
    }

    const allFilamentIds = new Set([...producedByCombo.keys(), ...consumedByCombo.keys()])
    const filaments = allFilamentIds.size > 0
      ? await prisma.filament.findMany({ where: { id: { in: [...allFilamentIds] } } })
      : []
    const filamentById = new Map(filaments.map((f) => [f.id, f]))

    const produced = [...producedByCombo.values()].reduce((sum, q) => sum + q, 0)
    const consumed = alreadyAssembled
    // Nunca negativo -- mesmo motivo do caso composto acima.
    const available = Math.max(0, produced - consumed)

    const colorOptions: AssemblyPartColorOption[] = Array.from(allFilamentIds).map((filamentId) => {
      const f = filamentById.get(filamentId)
      return {
        key: filamentId,
        filamentIds: [filamentId],
        label: f ? filamentLabel(f) : filamentId,
        available: Math.max(0, (producedByCombo.get(filamentId) ?? 0) - (consumedByCombo.get(filamentId) ?? 0)),
      }
    })

    // Mesmo ajuste do caso composto acima ("aviso falso de estoque
    // insuficiente"): `available` cego a cor pode ficar zerado/defasado
    // mesmo com produção nova disponível numa cor específica --
    // confirmAssembly/ConfirmAssemblyForm já validam por combo pra essa
    // peça sintética (chaveada pelo próprio productId), nunca contra este
    // campo. Quando há combo, `available` vira a soma por cor (bate com a
    // quebra exibida embaixo) e `maxUnitsFromThisPart` o melhor combo
    // isolado.
    const hasColorBreakdown = colorOptions.length > 0
    const colorAwareAvailable = hasColorBreakdown ? colorOptions.reduce((sum, c) => sum + c.available, 0) : available
    const colorAwareMaxUnits = hasColorBreakdown ? Math.max(...colorOptions.map((c) => c.available)) : available

    parts = [
      {
        partId: product.id,
        name: product.name,
        quantityPerUnit: 1,
        produced,
        consumed,
        available: colorAwareAvailable,
        maxUnitsFromThisPart: colorAwareMaxUnits,
        colorOptions,
      },
    ]
  }

  const accessoryRequirements: AssemblyResourceRequirement[] = product.accessoryUsages.map((u) => ({
    id: u.accessoryId,
    name: u.accessory.colorName ? `${u.accessory.name} — ${u.accessory.colorName}` : u.accessory.name,
    quantityPerUnit: u.quantity.toNumber(),
    available: Math.max(0, u.accessory.currentStock.toNumber()),
  }))
  const supplyRequirements: AssemblyResourceRequirement[] = product.supplyUsages.map((u) => ({
    id: u.supplyId,
    name: u.supply.name,
    quantityPerUnit: u.quantity.toNumber(),
    available: Math.max(0, u.supply.currentStock.toNumber()),
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

  // Melhoria "Histórico de consumo": cada decremento ganha uma linha em
  // StockConsumption (source ASSEMBLY, sourceId = esta montagem) -- até
  // aqui o decremento acontecia sem deixar NENHUM rastro de quanto foi
  // consumido, quando, ou por qual montagem. Usa $transaction em forma de
  // função (não array) porque as linhas de StockConsumption precisam do
  // id da ProductAssembly recém-criada.
  await prisma.$transaction(async (tx) => {
    const assembly = await tx.productAssembly.create({
      data: {
        productId,
        quantity,
        notes,
        colorChoices: Object.keys(colorChoicesToStore).length > 0 ? colorChoicesToStore : undefined,
      },
    })
    for (const c of accessoryConsumption) {
      await tx.accessory.update({ where: { id: c.accessoryId }, data: { currentStock: { decrement: c.quantity } } })
      await tx.stockConsumption.create({
        data: { resourceType: 'ACCESSORY', resourceId: c.accessoryId, quantity: c.quantity, productId, source: 'ASSEMBLY', sourceId: assembly.id },
      })
    }
    for (const c of supplyConsumption) {
      await tx.supply.update({ where: { id: c.supplyId }, data: { currentStock: { decrement: c.quantity } } })
      await tx.stockConsumption.create({
        data: { resourceType: 'SUPPLY', resourceId: c.supplyId, quantity: c.quantity, productId, source: 'ASSEMBLY', sourceId: assembly.id },
      })
    }
  })

  revalidatePath('/assembly')
  revalidatePath('/stock')
  revalidatePath('/accessories')
  revalidatePath('/supplies')
  return { success: true }
}
