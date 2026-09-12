'use server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { productNeedsAssembly } from '@/lib/products'
import { getProductVariantBreakdown, getOwnStockSummary } from '@/lib/reports'
import { getProductAverageProductionCost } from '@/actions/products'

type ActionResult = { success: boolean; error?: string }

function filamentLabel(f: { manufacturer: string; colorName: string; rollNumber: number }): string {
  return `${f.manufacturer} ${f.colorName} — Rolo #${String(f.rollNumber).padStart(3, '0')}`
}

function accessoryLabel(a: { name: string; colorName: string }): string {
  return a.colorName ? `${a.name} — ${a.colorName}` : a.name
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
  // Melhoria "Montagem" §4: bolinha de cor na tabela de Peças -- só
  // populado quando o combo resolve pra 1 filamento só (mesma convenção de
  // getProductVariantBreakdown em lib/reports.ts); combo multi-filamento
  // não tem uma bolinha única que o represente direito.
  colorHex: string | null
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

// Melhoria "Produto-como-componente": mesmo shape de AssemblyPartStatus,
// mas pra um PRODUTO inteiro usado como ingrediente (ex.: Mosquetão dentro
// de Chaveiro Café) em vez de uma ProductPart exclusiva deste produto --
// ver getComponentColorAvailability abaixo pro que torna esse estoque
// COMPARTILHADO entre vários produtos pai.
export interface AssemblyComponentStatus {
  componentProductId: string
  name: string
  quantityPerUnit: number
  produced: number
  consumed: number
  available: number
  maxUnitsFromThisComponent: number
  colorOptions: AssemblyPartColorOption[] | null
}

// Ajuste "produção → montagem → estoque": insumo/acessório cadastrado na
// ficha técnica do produto (composto OU simples) -- disponível em estoque
// AGORA, pra travar quantas unidades dá pra montar junto com as peças.
//
// Melhoria "Acessório com cor variável": `colorOptions` (mesmo shape já
// usado por peça/componente-produto) só é preenchido pra Acessório com
// "irmãos" de cor no catálogo (mesmo name+type, colorName diferente --
// ex. "Corrente Bolinha — Prata"/"— Dourada" são 2 linhas de Accessory
// distintas) -- Insumo/Embalagem sempre mandam null (fora de escopo desta
// melhoria). Diferente de peça/componente, `available` de cada opção usa
// Accessory.currentStock DIRETO (já é o número certo, sem precisar
// reconstruir "produzido menos consumido" de histórico -- acessório não
// tem "produção", só compra/consumo em tempo real).
export interface AssemblyResourceRequirement {
  id: string
  name: string
  quantityPerUnit: number
  available: number
  unit?: string
  colorOptions: AssemblyPartColorOption[] | null
}

export interface AssemblyStatus {
  productId: string
  productName: string
  isComposite: boolean
  parts: AssemblyPartStatus[]
  // Melhoria "Produto-como-componente": outros PRODUTOS usados como
  // ingrediente (ProductComponentUsage) -- falta de componente bloqueia a
  // montagem igual falta de peça (ver maxAssemblableUnits abaixo).
  components: AssemblyComponentStatus[]
  accessoryRequirements: AssemblyResourceRequirement[]
  supplyRequirements: AssemblyResourceRequirement[]
  // Melhoria "Montagem" §5: puramente informativo -- Embalagem continua
  // sendo consumida só na Venda (actions/sales.ts#consumePackagingForSale),
  // nunca na Montagem. Aparece aqui só pra visibilidade da ficha técnica
  // completa (com o resto dos componentes), nunca decrementa estoque nem
  // entra em maxAssemblableUnits abaixo.
  packagingRequirements: AssemblyResourceRequirement[]
  maxAssemblableUnits: number
  // Melhoria "Montagem" §3: total de unidades do PRODUTO já montadas (soma
  // de ProductAssembly.quantity) -- vira card de resumo na tela de detalhe
  // (antes era uma coluna dentro da tabela de peças) e alimenta a lista
  // geral (getAssemblyOverview).
  alreadyAssembled: number
}

// Melhoria "Produto-como-componente": disponibilidade por cor de um
// PRODUTO usado como componente de outro (ex.: Mosquetão dentro de
// Chaveiro Café) -- estoque COMPARTILHADO entre TODOS os produtos pai que
// o usam (decisão confirmada com o usuário: um único pool, não um estoque
// duplicado por produto pai). "Produzido por combo" reaproveita
// getProductVariantBreakdown (lib/reports.ts, já lida com o componente
// precisar ou não de montagem própria -- o formato exato da chave que ela
// devolve não importa aqui, só precisa ser estável: é a mesma chave que
// confirmAssembly grava de volta em ProductAssembly.colorChoices e que
// esta função relê depois, nunca comparada contra nenhum outro formato).
// "Consumido por combo" soma TODAS as ProductAssembly de QUALQUER produto
// pai que declarou este componente na ficha técnica, multiplicando pela
// quantidade DAQUELE produto pai especificamente (produtos pai diferentes
// podem pedir quantidades diferentes do mesmo componente).
//
// Limitação aceita (documentada, mesmo padrão já usado em
// getProductVariantStockOptions pra venda/consignação): venda direta/
// consignação deste componente NÃO é descontada por cor aqui, só consumo-como-
// componente -- a agregada 100% líquida é getOwnStockSummary (lib/reports.ts),
// usada em Meu Estoque.
async function getComponentColorAvailability(componentProductId: string): Promise<AssemblyPartColorOption[]> {
  const component = await prisma.product.findUniqueOrThrow({
    where: { id: componentProductId },
    include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
  })
  const needsAssemblyOfComponent = productNeedsAssembly({
    isComposite: component.isComposite,
    accessoryUsagesCount: component._count.accessoryUsages,
    supplyUsagesCount: component._count.supplyUsages,
    componentUsagesCount: component._count.componentUsages,
  })
  const produced = await getProductVariantBreakdown(componentProductId, needsAssemblyOfComponent)
  if (produced.length === 0) return []

  const usagesOfThisComponent = await prisma.productComponentUsage.findMany({ where: { componentProductId } })
  const quantityByParentId = new Map(usagesOfThisComponent.map((u) => [u.productId, u.quantity]))
  const parentIds = usagesOfThisComponent.map((u) => u.productId)

  const consumedByCombo = new Map<string, number>()
  if (parentIds.length > 0) {
    const assemblies = await prisma.productAssembly.findMany({
      where: { productId: { in: parentIds } },
      select: { productId: true, quantity: true, colorChoices: true },
    })
    for (const a of assemblies) {
      const choices = a.colorChoices as Record<string, string> | null
      const key = choices?.[componentProductId]
      if (!key) continue
      const qtyPerUnit = quantityByParentId.get(a.productId) ?? 0
      consumedByCombo.set(key, (consumedByCombo.get(key) ?? 0) + a.quantity * qtyPerUnit)
    }
  }

  return produced.map((p) => ({
    key: p.key,
    filamentIds: [],
    label: p.label,
    available: Math.max(0, p.quantity - (consumedByCombo.get(p.key) ?? 0)),
    colorHex: p.colorHex,
  }))
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
      packagingUsages: { include: { packagingItem: true } },
      componentUsages: { include: { componentProduct: true } },
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
          colorHex: filamentIds.length === 1 ? (filamentById.get(filamentIds[0])?.colorHex ?? null) : null,
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
        colorHex: f?.colorHex ?? null,
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

  // Melhoria "Acessório com cor variável": "irmãos" de cor de cada
  // Acessório da ficha técnica -- mesmo name+type, colorName diferente
  // (ex. "Corrente Bolinha — Prata"/"— Dourada"). Busca em lote (não
  // N+1), catálogo pequeno como o resto do app assume.
  const accessoryFamilies = product.accessoryUsages.length > 0
    ? await prisma.accessory.findMany({
        where: {
          active: true,
          OR: product.accessoryUsages.map((u) => ({ name: u.accessory.name, type: u.accessory.type })),
        },
      })
    : []
  const accessoryFamilyKey = (a: { name: string; type: string }) => `${a.name}::${a.type}`
  const accessoryFamilyMap = new Map<string, typeof accessoryFamilies>()
  for (const a of accessoryFamilies) {
    const key = accessoryFamilyKey(a)
    const list = accessoryFamilyMap.get(key) ?? []
    list.push(a)
    accessoryFamilyMap.set(key, list)
  }

  const accessoryRequirements: AssemblyResourceRequirement[] = product.accessoryUsages.map((u) => {
    const siblings = accessoryFamilyMap.get(accessoryFamilyKey(u.accessory)) ?? []
    const colorOptions = siblings.length > 1
      ? siblings.map((s) => ({
          key: s.id,
          filamentIds: [],
          label: accessoryLabel(s),
          available: Math.max(0, s.currentStock.toNumber()),
          colorHex: s.colorHex,
        }))
      : null
    return {
      id: u.accessoryId,
      name: accessoryLabel(u.accessory),
      quantityPerUnit: u.quantity.toNumber(),
      available: Math.max(0, u.accessory.currentStock.toNumber()),
      colorOptions,
    }
  })
  const supplyRequirements: AssemblyResourceRequirement[] = product.supplyUsages.map((u) => ({
    id: u.supplyId,
    name: u.supply.name,
    quantityPerUnit: u.quantity.toNumber(),
    available: Math.max(0, u.supply.currentStock.toNumber()),
    unit: u.supply.unit,
    colorOptions: null,
  }))
  const packagingRequirements: AssemblyResourceRequirement[] = product.packagingUsages.map((u) => ({
    id: u.packagingItemId,
    name: u.packagingItem.name,
    quantityPerUnit: u.quantity.toNumber(),
    available: Math.max(0, u.packagingItem.currentStock.toNumber()),
    colorOptions: null,
  }))

  // Melhoria "Produto-como-componente": outros PRODUTOS usados como
  // ingrediente (ex.: Mosquetão dentro de Chaveiro Café) -- mesma
  // severidade de bloqueio que peça (não insumo/acessório): é uma peça
  // física necessária, sem substituto. Estoque compartilhado entre todos
  // os produtos pai que usam o mesmo componente (getComponentColorAvailability).
  const components: AssemblyComponentStatus[] = await Promise.all(
    product.componentUsages.map(async (usage) => {
      const colorOptions = await getComponentColorAvailability(usage.componentProductId)
      const produced = colorOptions.reduce((sum, c) => sum + c.available, 0) // aproximação: soma do disponível por combo (não existe "produzido bruto" único aqui, ver getComponentColorAvailability)
      const available = produced
      const maxUnitsFromThisComponent = colorOptions.length === 0
        ? 0
        : Math.max(...colorOptions.map((c) => Math.floor(c.available / usage.quantity)))
      return {
        componentProductId: usage.componentProductId,
        name: usage.componentProduct.name,
        quantityPerUnit: usage.quantity,
        produced,
        consumed: 0,
        available,
        maxUnitsFromThisComponent,
        colorOptions: colorOptions.length > 0 ? colorOptions : null,
      }
    }),
  )

  // Melhoria "Montagem" §4/§5/§6: só falta de PEÇA (ou, agora, de
  // componente-produto) bloqueia a montagem -- não existe substituto pra
  // uma peça não impressa. Falta de acessório/insumo (e embalagem, nunca
  // consumida aqui) não trava mais o cálculo de quanto dá pra montar, só
  // gera aviso (calculado à parte pela tela a partir de
  // accessoryRequirements/supplyRequirements/packagingRequirements -- ver
  // comentário em confirmAssembly abaixo sobre o mesmo ajuste do lado da
  // escrita).
  const allLimits = [...parts.map((p) => p.maxUnitsFromThisPart), ...components.map((c) => c.maxUnitsFromThisComponent)]
  const maxAssemblableUnits = allLimits.length === 0 ? 0 : Math.max(0, Math.min(...allLimits))

  return {
    productId: product.id,
    productName: product.name,
    isComposite: product.isComposite,
    parts,
    components,
    accessoryRequirements,
    supplyRequirements,
    packagingRequirements,
    maxAssemblableUnits,
    alreadyAssembled,
  }
}

function comboKeyFromRun(run: { filamentId: string; filamentUsages: { filamentId: string }[] }): string {
  const ids = run.filamentUsages.length > 0 ? run.filamentUsages.map((u) => u.filamentId) : [run.filamentId]
  return [...new Set(ids)].sort().join(',')
}

// Bug "cancelar/excluir produção já montada deixa Montagem/Estoque
// desatualizados": ProductAssembly não tem NENHUM vínculo (FK) com a(s)
// ProductionRun que a originaram -- "consumido" é só a soma de
// ProductAssembly.quantity por combo (ProductAssembly.colorChoices),
// nunca reduzido quando uma ProductionRun que já tinha sido montada é
// cancelada/excluída depois. Chamada por cancelProductionRun/
// deleteProductionRun (actions/productionRuns.ts) DENTRO da mesma
// transação, antes de gravar o cancelamento/exclusão em si -- nunca pela
// tela de Montagem.
//
// Descobre se cancelar/excluir `run` deixaria "consumido > produzido" pro
// combo de cor dela (produção que já tinha sido 100% ou parcialmente
// consumida numa montagem confirmada) e, se sim, desmonta o excedente:
// reduz (ou apaga) a(s) ProductAssembly mais recente(s) daquele combo e
// estorna, na mesma proporção, o acessório/insumo que elas consumiram
// (via StockConsumption, que já registra exatamente quanto cada montagem
// decrementou -- fonte de verdade, não reconstrói nada). Nunca mexe em
// Sale/ConsignmentDelivery/uso-como-componente de outro produto: se o
// excedente a desmontar já foi vendido/consignado/consumido por outro
// produto, recusa (nada é escrito) e devolve um erro explicando o motivo.
export interface AssemblyReversalResult {
  success: boolean
  error?: string
  // Produtos cuja ProductAssembly foi reduzida/apagada nesta reversão --
  // usado pela UI (botão "Excluir" em /stock) pra "sinalizar quais peças
  // ficaram incompletas". Um produto SIMPLES sem montagem própria (ex.:
  // Mosquetão) nunca aparece aqui como dono de nada (não tem
  // ProductAssembly própria) -- quem aparece são os produtos PAI que o
  // usaram como componente.
  reversed?: { productId: string; productName: string; unitsReversed: number }[]
}

export async function reverseExcessAssemblyForRun(
  tx: Prisma.TransactionClient,
  run: { id: string; productId: string; productPartId: string | null; filamentId: string; quantitySuccess: number; filamentUsages: { filamentId: string }[] },
): Promise<AssemblyReversalResult> {
  const partKey = run.productPartId ?? run.productId
  const comboKey = comboKeyFromRun(run)

  // Produzido depois de cancelar/excluir esta run: soma de quantitySuccess
  // de OUTRAS produções não-canceladas da mesma peça/produto E do mesmo
  // combo de cor (exclui a própria `run`, que está sendo cancelada/excluída
  // agora -- ainda não foi gravada como tal neste ponto).
  const otherRuns = await tx.productionRun.findMany({
    where: {
      status: { not: 'CANCELADA' },
      id: { not: run.id },
      ...(run.productPartId ? { productPartId: run.productPartId } : { productId: run.productId, productPartId: null }),
    },
    select: { filamentId: true, quantitySuccess: true, filamentUsages: { select: { filamentId: true } } },
  })
  const producedAfter = otherRuns.filter((r) => comboKeyFromRun(r) === comboKey).reduce((sum, r) => sum + r.quantitySuccess, 0)

  // Bug "Mosquetão compartilhado não desmonta": quando esta run produziu um
  // PRODUTO inteiro direto (productPartId nulo -- produto simples ou "peça
  // sintética"), `partKey` (= run.productId) pode estar gravado em
  // ProductAssembly.colorChoices de DUAS origens -- a própria montagem
  // deste produto (se ele mesmo precisa de montagem) OU a montagem de
  // QUALQUER OUTRO produto que o usa como componente
  // (confirmAssembly grava colorChoicesToStore[component.componentProductId],
  // ou seja, na ProductAssembly do PRODUTO PAI, nunca na do componente).
  // Só filtra por productId quando a chave é de ProductPart (peça de
  // composto só pode aparecer na montagem do seu próprio pai).
  const assemblies = await tx.productAssembly.findMany({
    where: run.productPartId ? { productId: run.productId } : {},
    orderBy: { assembledAt: 'desc' },
  })
  const choicesOf = (a: (typeof assemblies)[number]) => a.colorChoices as Record<string, string> | null
  const matchingAssemblies = assemblies.filter((a) => choicesOf(a)?.[partKey] === comboKey)
  const consumed = matchingAssemblies.reduce((sum, a) => sum + a.quantity, 0)

  const deficit = consumed - producedAfter
  if (deficit <= 0) return { success: true }

  // Legado sem cor gravada (colorChoices nulo ou sem entrada pra esta
  // peça/produto) -- só usado como último recurso, se o combo específico
  // não tiver ProductAssembly suficiente pra cobrir o déficit sozinho.
  // Nunca toca uma linha que gravou explicitamente OUTRO combo.
  const fallbackAssemblies = assemblies.filter((a) => {
    const choices = choicesOf(a)
    return choices == null || choices[partKey] === undefined
  })

  // Quanto está livre pra desmontar sem mexer no que já saiu -- mesma
  // fórmula de getOwnStockSummary (Estoque), nunca duplicada: já desconta
  // vendido/consignado/usado-como-componente/ajustes manuais. Rastreado
  // POR PRODUTO DONO de cada ProductAssembly candidata (não só
  // run.productId): uma peça compartilhada (Mosquetão) pode aparecer em
  // ProductAssembly de produtos pai DIFERENTES, cada um com seu próprio
  // "livre".
  const stockSummary = await getOwnStockSummary()
  const freeRemaining = new Map<string, number>()
  function freeFor(productId: string): number {
    if (!freeRemaining.has(productId)) {
      freeRemaining.set(productId, stockSummary.find((s) => s.productId === productId)?.available ?? 0)
    }
    return freeRemaining.get(productId)!
  }

  // Monta o plano ANTES de escrever qualquer coisa -- só aplica se der pra
  // cobrir o déficit inteiro dentro do "livre" de cada produto dono.
  let remaining = deficit
  const plan: { assembly: (typeof assemblies)[number]; units: number }[] = []
  const blockedProductIds = new Set<string>()
  for (const assembly of [...matchingAssemblies, ...fallbackAssemblies]) {
    if (remaining <= 0) break
    const wanted = Math.min(remaining, assembly.quantity)
    if (wanted <= 0) continue
    const free = freeFor(assembly.productId)
    const take = Math.min(wanted, free)
    if (take < wanted) blockedProductIds.add(assembly.productId)
    if (take <= 0) continue
    plan.push({ assembly, units: take })
    freeRemaining.set(assembly.productId, free - take)
    remaining -= take
  }

  if (remaining > 0) {
    const names = [...blockedProductIds].map((id) => stockSummary.find((s) => s.productId === id)?.productName ?? id)
    const label = names.length > 0 ? names.join(', ') : 'outro produto que usa este item'
    return {
      success: false,
      error: `Não é possível cancelar/excluir esta produção: ${remaining} unidade(s) já foram vendidas, consignadas ou usadas como componente (${label}). Cancele a venda/consignação correspondente antes.`,
    }
  }

  const reversedByProduct = new Map<string, number>()
  for (const { assembly, units } of plan) {
    const fraction = units / assembly.quantity
    const fullyReversed = units === assembly.quantity

    const consumptions = await tx.stockConsumption.findMany({ where: { source: 'ASSEMBLY', sourceId: assembly.id } })
    for (const c of consumptions) {
      const totalQty = c.quantity.toNumber()
      const reverseQty = fullyReversed ? totalQty : totalQty * fraction
      if (c.resourceType === 'ACCESSORY') {
        await tx.accessory.update({ where: { id: c.resourceId }, data: { currentStock: { increment: reverseQty } } })
      } else if (c.resourceType === 'SUPPLY') {
        await tx.supply.update({ where: { id: c.resourceId }, data: { currentStock: { increment: reverseQty } } })
      }
      if (fullyReversed) {
        await tx.stockConsumption.delete({ where: { id: c.id } })
      } else {
        await tx.stockConsumption.update({ where: { id: c.id }, data: { quantity: totalQty - reverseQty } })
      }
    }

    if (fullyReversed) {
      await tx.productAssembly.delete({ where: { id: assembly.id } })
    } else {
      const snapshot = assembly.costSnapshot as { componentProductsCost: number; total: number } | null
      const newSnapshot = snapshot
        ? { componentProductsCost: snapshot.componentProductsCost * (1 - fraction), total: snapshot.total * (1 - fraction) }
        : undefined
      await tx.productAssembly.update({
        where: { id: assembly.id },
        data: { quantity: assembly.quantity - units, ...(newSnapshot ? { costSnapshot: newSnapshot } : {}) },
      })
    }

    reversedByProduct.set(assembly.productId, (reversedByProduct.get(assembly.productId) ?? 0) + units)
  }

  const reversed = [...reversedByProduct.entries()].map(([productId, unitsReversed]) => ({
    productId,
    productName: stockSummary.find((s) => s.productId === productId)?.productName ?? productId,
    unitsReversed,
  }))

  return { success: true, reversed }
}

export interface AssemblyOverviewRow {
  productId: string
  productName: string
  partsCount: number
  alreadyAssembled: number
  maxAssemblableUnits: number
}

// Melhoria "Montagem" §2: lista geral no topo da tela -- todo produto que
// passa por Montagem (mesma regra de app/(app)/assembly/page.tsx: composto
// OU simples com insumo/acessório cadastrado), com "Já montado"/"Disponível
// pra montagem" pra dar uma visão de quais produtos precisam de atenção
// antes de escolher um. Reaproveita getAssemblyStatus por produto (catálogo
// é pequeno, mesmo padrão N+1-em-paralelo já usado por getOwnStockSummary's
// variantBreakdowns em /stock) -- garante que os números batem exatamente
// com os da tela de detalhe, em vez de uma segunda fórmula que pudesse
// divergir.
export async function getAssemblyOverview(): Promise<AssemblyOverviewRow[]> {
  const products = await prisma.product.findMany({
    where: {
      active: true,
      OR: [{ isComposite: true }, { accessoryUsages: { some: {} } }, { supplyUsages: { some: {} } }, { componentUsages: { some: {} } }],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  const statuses = await Promise.all(products.map((p) => getAssemblyStatus(p.id)))

  return statuses.map((status) => ({
    productId: status.productId,
    productName: status.productName,
    partsCount: status.parts.length,
    alreadyAssembled: status.alreadyAssembled,
    maxAssemblableUnits: status.maxAssemblableUnits,
  }))
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

  // Melhoria "Produto-como-componente": mesma checagem/escolha de cor da
  // peça acima, agora pra outros PRODUTOS usados como ingrediente --
  // chaveado por componentProductId em colorChoicesToStore (mesmo mapa,
  // sem conflito de namespace com productPartId).
  const componentProductsConsumed: { componentProductId: string; quantityConsumed: number }[] = []
  for (const component of status.components) {
    if (!component.colorOptions) {
      if (component.maxUnitsFromThisComponent < quantity) {
        insufficient.push(`${component.name} (dá pra montar só ${component.maxUnitsFromThisComponent})`)
      }
      continue
    }
    const chosenKey = submittedColorChoices[component.componentProductId]
    const chosenOption = component.colorOptions.find((o) => o.key === chosenKey)
    if (!chosenOption) {
      insufficient.push(`${component.name} (selecione a cor)`)
      continue
    }
    const maxUnitsForColor = Math.floor(chosenOption.available / component.quantityPerUnit)
    if (maxUnitsForColor < quantity) {
      insufficient.push(`${component.name} ${chosenOption.label} (dá pra montar só ${maxUnitsForColor})`)
      continue
    }
    colorChoicesToStore[component.componentProductId] = chosenKey
    componentProductsConsumed.push({ componentProductId: component.componentProductId, quantityConsumed: component.quantityPerUnit * quantity })
  }

  // Melhoria "Acessório com cor variável": mesmo registro de escolha de
  // cor de peça/componente acima, mas NÃO bloqueia (mesma filosofia já
  // documentada -- falta de acessório nunca trava a montagem, só avisa).
  // O consumo em si (accessoryConsumption, abaixo) continua vindo de
  // accessoryUsagesJson exatamente como antes -- isso só REGISTRA qual
  // cor foi escolhida, pra Estoque/Vendas conseguirem diferenciar depois.
  // Sem escolha válida submetida, simplesmente não grava esse par (nunca
  // inventa qual cor foi usada).
  for (const accessory of status.accessoryRequirements) {
    if (!accessory.colorOptions) continue
    const chosenKey = submittedColorChoices[accessory.id]
    const chosenOption = accessory.colorOptions.find((o) => o.key === chosenKey)
    if (chosenOption) colorChoicesToStore[accessory.id] = chosenKey
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

  // Melhoria "Montagem" §5/§6: falta de acessório/insumo NÃO bloqueia mais
  // a montagem (só falta de peça bloqueia, ver `insufficient` acima) --
  // sempre consome o que foi pedido, mesmo que deixe currentStock negativo,
  // mesmo raciocínio já usado pra Embalagem na Venda (actions/sales.ts#
  // consumePackagingForSale: "a pessoa pode montar/vender mesmo assim e
  // resolver o estoque depois"). O aviso não-bloqueante ("Estoque baixo
  // de: X") é calculado pela tela a partir de accessoryRequirements/
  // supplyRequirements ANTES da submissão, não impede o confirmAssembly.
  const accessoryConsumption: { accessoryId: string; quantity: number }[] = []
  for (const u of submittedAccessoryUsages) {
    if (u.quantityPerUnit <= 0) continue
    const accessory = accessoryById.get(u.id)
    if (!accessory) continue
    accessoryConsumption.push({ accessoryId: u.id, quantity: u.quantityPerUnit * quantity })
  }
  const supplyConsumption: { supplyId: string; quantity: number }[] = []
  for (const u of submittedSupplyUsages) {
    if (u.quantityPerUnit <= 0) continue
    const supply = supplyById.get(u.id)
    if (!supply) continue
    supplyConsumption.push({ supplyId: u.id, quantity: u.quantityPerUnit * quantity })
  }

  if (insufficient.length > 0) {
    return { success: false, error: `Estoque insuficiente: ${insufficient.join('; ')}` }
  }

  // Melhoria "Produto-como-componente": custo dos componentes-produto
  // consumidos nesta leva -- quantidade × custo médio de produção do
  // componente NO MOMENTO desta montagem (getProductAverageProductionCost,
  // ao vivo), congelado em ProductAssembly.costSnapshot e nunca
  // recalculado depois (mesmo padrão de ProductionRun.costSnapshot).
  const componentCosts = await Promise.all(
    componentProductsConsumed.map(async (c) => c.quantityConsumed * (await getProductAverageProductionCost(c.componentProductId))),
  )
  const componentProductsCost = componentCosts.reduce((sum, c) => sum + c, 0)
  const costSnapshot = componentProductsConsumed.length > 0 ? { componentProductsCost, total: componentProductsCost } : undefined

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
        costSnapshot,
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
