import { prisma } from '@/lib/prisma'
import { getStockStatus, calculateStockReferenceQuantity, calculateStockPercentRemaining, type ProductionCostSnapshot } from '@/lib/costing'
import { productNeedsAssembly } from '@/lib/products'
import type { Prisma, ProductionStatus, WasteReason } from '@prisma/client'

// Badge do menu lateral (Filamentos, AppLayoutClient) -- mesma definição de
// "Estoque baixo" já usada na tela de Filamentos (lib/costing.ts#getStockStatus),
// pra badge do menu, chip da tela e status de cada linha nunca divergirem.
// Só filamento com estoque > 0 entra na conta (esgotado é outra categoria,
// já sinalizada à parte na própria tela de Filamentos).
export async function getFilamentsLowStockCount(): Promise<number> {
  const filaments = await prisma.filament.findMany({
    where: { currentStockGrams: { gt: 0 } },
    select: { currentStockGrams: true, purchases: { select: { weightGrams: true }, orderBy: { purchaseDate: 'desc' } } },
  })
  return filaments.filter((f) => {
    const current = f.currentStockGrams.toNumber()
    const referenceQuantity = calculateStockReferenceQuantity(f.purchases.map((p) => p.weightGrams.toNumber()))
    const percentRemaining = calculateStockPercentRemaining(current, referenceQuantity)
    return getStockStatus(percentRemaining).label === 'Estoque baixo'
  }).length
}

// Melhoria "Histórico de consumo": ao contrário de Acessório/Insumo/
// Embalagem (que não tinham NENHUM rastro de consumo até essa melhoria,
// ver actions/stockConsumptions.ts), Filamento já tem consumo totalmente
// rastreado via ProductionRun -- não cria uma tabela nova redundante, só
// expõe essa leitura. `filamentId` escalar cobre peça de 1 filamento
// (sempre) e o 1º componente de peça multi-filamento (ProductionRunFilamentUsage
// opcional não criado); quando `filamentUsages` para ESTE filamento existe,
// usa o valor real daquele componente em vez do escalar (que pra peça
// multi-filamento é a SOMA de todos os componentes, não só deste).
export interface FilamentConsumptionRow {
  id: string
  date: Date
  productName: string
  partName: string | null
  gramsUsed: number
  gramsWasted: number
}

export async function getFilamentConsumptionHistory(filamentId: string): Promise<FilamentConsumptionRow[]> {
  const runs = await prisma.productionRun.findMany({
    where: {
      status: { not: 'CANCELADA' },
      OR: [{ filamentId }, { filamentUsages: { some: { filamentId } } }],
    },
    include: {
      product: { select: { name: true } },
      productPart: { select: { name: true } },
      filamentUsages: { where: { filamentId } },
    },
    orderBy: { date: 'desc' },
  })

  return runs.map((run) => {
    const usage = run.filamentUsages[0]
    return {
      id: run.id,
      date: run.date,
      productName: run.product.name,
      partName: run.productPart?.name ?? null,
      gramsUsed: usage ? usage.gramsUsed.toNumber() : run.gramsUsed.toNumber(),
      gramsWasted: usage ? usage.gramsWasted.toNumber() : run.gramsWasted.toNumber(),
    }
  })
}

// 3.6 estendeu SaleChannel com SHOPEE/MERCADO_LIVRE (além do MARKETPLACE
// legado) -- pro Dashboard, que só distingue Direta vs Marketplace no
// gráfico de participação, os três contam pro mesmo balde "MARKETPLACE".
export async function getRevenueByChannel(): Promise<Record<'DIRETA' | 'MARKETPLACE', number>> {
  const sales = await prisma.sale.findMany()
  const result = { DIRETA: 0, MARKETPLACE: 0 }
  for (const s of sales) {
    const bucket = s.channel === 'DIRETA' ? 'DIRETA' : 'MARKETPLACE'
    result[bucket] += s.quantity * s.unitPrice.toNumber()
  }
  return result
}

export async function getConsignmentRevenue(): Promise<number> {
  const reports = await prisma.consignmentSaleReport.findMany({ include: { delivery: true } })
  return reports.reduce((sum, r) => {
    const unitPrice = r.unitPrice?.toNumber() ?? r.delivery.unitPrice.toNumber()
    const commission = r.commissionPercent.toNumber()
    return sum + r.quantitySold * unitPrice * (1 - commission)
  }, 0)
}

export async function getTopProducts(limit = 5) {
  const grouped = await prisma.sale.groupBy({
    by: ['productId'],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  })
  const products = await prisma.product.findMany({ where: { id: { in: grouped.map((g) => g.productId) } } })
  return grouped.map((g) => ({
    product: products.find((p) => p.id === g.productId)!,
    quantitySold: g._sum.quantity ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// Dashboard de produção (spec §6, task-9 brief).
//
// Every ProductionRun's cost is read from its own `costSnapshot` -- computed
// ONCE at creation time (Task 5/7, lib/costing.ts#buildProductionCostSnapshot)
// and never rewritten. These aggregations sum that frozen field; they never
// recompute cost from current Settings/Printer/Filament/Accessory/Supply
// state, matching spec §4's "altering a global setting must never change the
// historical cost of an already-recorded run" rule (same rule Task 8's
// history table follows for its "Custo" column).
//
// costSnapshot is nullable only for rows created before Task 7 added the
// column (see prisma/schema.prisma's doc comment on it) -- there is no
// historical Printer/Filament/Settings state to reconstruct one for them, so
// such legacy runs contribute 0 to totalCost/totalWasteCost here (same "—"
// treatment the production history table gives them) while still counting
// toward totalRuns/totalUnitsProduced/totalTimeHours, which don't depend on
// the snapshot.
// ---------------------------------------------------------------------------

export interface ProductionReportFilters {
  from?: Date
  to?: Date
  productId?: string
  printerId?: string
  status?: ProductionStatus
  wasteReason?: WasteReason
}

function buildProductionRunWhere(filters: ProductionReportFilters): Prisma.ProductionRunWhereInput {
  const where: Prisma.ProductionRunWhereInput = {}
  if (filters.from || filters.to) {
    where.date = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    }
  }
  if (filters.productId) where.productId = filters.productId
  if (filters.printerId) where.printerId = filters.printerId
  if (filters.status) where.status = filters.status
  if (filters.wasteReason) where.wasteReason = filters.wasteReason
  return where
}

// Shared fetch used by every report function below -- keeps the Prisma
// `where` construction and the `include`s (product/printer, needed for
// printTimeHours/grouping) in one place instead of duplicated per function.
async function getFilteredProductionRuns(filters: ProductionReportFilters) {
  return prisma.productionRun.findMany({
    where: buildProductionRunWhere(filters),
    include: { product: true, printer: true },
  })
}

function readSnapshot(run: { costSnapshot: unknown }): ProductionCostSnapshot | null {
  return run.costSnapshot as ProductionCostSnapshot | null
}

// Fix 5 (task-10 brief): a CANCELADA run had every resource it consumed
// fully reversed by cancelProductionRun (spec §5.5) -- it represents zero
// real incurred cost, so it must NOT inflate "Custo total"/"Desperdício
// total" by default. It still keeps its own frozen costSnapshot (never
// rewritten, same as any other run) so its cost isn't lost -- it just isn't
// counted automatically. The one exception: if the caller explicitly asked
// to filter down to status=CANCELADA (they deliberately want to inspect
// cancelled runs), its cost IS counted for that explicit view -- the
// existing status filter still lets a user see it if they choose, per the
// brief.
function shouldCountCost(run: { status: ProductionStatus }, filters: ProductionReportFilters): boolean {
  if (run.status !== 'CANCELADA') return true
  return filters.status === 'CANCELADA'
}

export interface ProductionSummary {
  totalRuns: number
  totalUnitsProduced: number
  successRate: number // 0-100, sum(quantitySuccess) / sum(quantityPlanned)
  totalTimeHours: number
  totalCost: number
  totalWasteCost: number
}

export async function getProductionSummary(filters: ProductionReportFilters = {}): Promise<ProductionSummary> {
  const runs = await getFilteredProductionRuns(filters)

  let totalUnitsProduced = 0
  let totalPlanned = 0
  let totalTimeHours = 0
  let totalCost = 0
  let totalWasteCost = 0

  for (const run of runs) {
    totalUnitsProduced += run.quantitySuccess
    totalPlanned += run.quantityPlanned
    totalTimeHours += run.product.printTimeHours.toNumber() * run.quantitySuccess + run.timeWastedHours.toNumber()
    const snapshot = readSnapshot(run)
    if (snapshot && shouldCountCost(run, filters)) {
      totalCost += snapshot.total
      totalWasteCost += snapshot.wasteCost
    }
  }

  return {
    totalRuns: runs.length,
    totalUnitsProduced,
    successRate: totalPlanned > 0 ? (totalUnitsProduced / totalPlanned) * 100 : 0,
    totalTimeHours,
    totalCost,
    totalWasteCost,
  }
}

export interface ProductionByProductRow {
  productId: string
  productName: string
  runsCount: number
  quantitySuccess: number
  totalCost: number
}

export async function getProductionByProduct(filters: ProductionReportFilters = {}): Promise<ProductionByProductRow[]> {
  const runs = await getFilteredProductionRuns(filters)
  const byProduct = new Map<string, ProductionByProductRow>()

  for (const run of runs) {
    const row = byProduct.get(run.productId) ?? {
      productId: run.productId,
      productName: run.product.name,
      runsCount: 0,
      quantitySuccess: 0,
      totalCost: 0,
    }
    row.runsCount += 1
    row.quantitySuccess += run.quantitySuccess
    const snapshot = readSnapshot(run)
    if (snapshot && shouldCountCost(run, filters)) row.totalCost += snapshot.total
    byProduct.set(run.productId, row)
  }

  return [...byProduct.values()].sort((a, b) => b.quantitySuccess - a.quantitySuccess)
}

export interface FailuresByWasteReasonRow {
  wasteReason: WasteReason
  runsCount: number
  quantityFailed: number
}

// Only runs with a classified wasteReason are grouped here -- a run can have
// quantityFailed > 0 without a wasteReason set (it's optional, spec §5.4), and
// such unclassified failures don't belong to any reason bucket.
export async function getFailuresByWasteReason(filters: ProductionReportFilters = {}): Promise<FailuresByWasteReasonRow[]> {
  const runs = await getFilteredProductionRuns(filters)
  const byReason = new Map<WasteReason, FailuresByWasteReasonRow>()

  for (const run of runs) {
    if (!run.wasteReason) continue
    const row = byReason.get(run.wasteReason) ?? { wasteReason: run.wasteReason, runsCount: 0, quantityFailed: 0 }
    row.runsCount += 1
    row.quantityFailed += run.quantityFailed
    byReason.set(run.wasteReason, row)
  }

  return [...byReason.values()].sort((a, b) => b.quantityFailed - a.quantityFailed)
}

export interface PrinterUsageRow {
  printerId: string
  printerName: string
  runsCount: number
  totalHours: number
}

export async function getPrinterUsage(filters: ProductionReportFilters = {}): Promise<PrinterUsageRow[]> {
  const runs = await getFilteredProductionRuns(filters)
  const byPrinter = new Map<string, PrinterUsageRow>()

  for (const run of runs) {
    const row = byPrinter.get(run.printerId) ?? {
      printerId: run.printerId,
      printerName: run.printer.name,
      runsCount: 0,
      totalHours: 0,
    }
    row.runsCount += 1
    row.totalHours += run.product.printTimeHours.toNumber() * run.quantitySuccess + run.timeWastedHours.toNumber()
    byPrinter.set(run.printerId, row)
  }

  return [...byPrinter.values()].sort((a, b) => b.runsCount - a.runsCount)
}

// 2.2 Estoque próprio de produtos acabados: tudo derivado das tabelas que já
// existem (ProductionRun/Sale/ConsignmentDelivery) -- sem ledger novo,
// então não há segunda fonte de verdade pra divergir do que as outras
// telas já mostram. Fórmula do módulo: disponível = produzido - vendido
// diretamente - entregue a parceiros.
//
// "Produzido" de um produto SIMPLES soma ProductionRun.quantitySuccess
// (productPartId null, status != CANCELADA) direto. De um produto
// COMPOSTO soma ProductAssembly.quantity (2.3) -- uma produção de PEÇA
// isolada (productPartId setado) não vira estoque de produto acabado até
// passar pela montagem; só a montagem confirmada conta como "produzido".
//
// "Em produção" soma Order.quantity com status != CONCLUIDO (2.4) --
// qualquer pedido ainda no pipeline (Recebido/Em produção/Pronto/
// Despachado) conta como "ordem aberta"; ao concluir, vira Sale e some
// daqui (já não é mais "em produção", é venda).
export interface OwnStockRow {
  productId: string
  productName: string
  isComposite: boolean
  // Ajuste "produção → montagem → estoque": true pra composto OU pra
  // simples com insumo/acessório cadastrado -- usado na UI pra explicar
  // por que "produzido" só sobe depois de confirmar a montagem.
  needsAssembly: boolean
  produced: number
  soldDirect: number
  deliveredToPartners: number
  consignmentRemaining: number
  inProduction: number
  // Melhoria "Produto-como-componente": quantas unidades já foram
  // consumidas por OUTRO produto que usa este como ingrediente (ex.:
  // Mosquetão consumido pela montagem de Chaveiro Café) -- 0 pra produto
  // que nunca é usado como componente. Já descontado de `available` abaixo.
  consumedAsComponent: number
  // Melhoria "Pedidos com reserva de estoque": quantas unidades algum
  // pedido não-terminal já garantiu pra si (reconcileOrderReservations),
  // já descontado de `available` abaixo.
  reserved: number
  available: number
}

export interface ProductVariantBreakdownRow {
  // Melhoria "Parceiros de consignação" §5: identificador estável da
  // variante, usado por ConsignmentDelivery.colorComboKey e
  // ProductAccessoryColorUsage.colorComboKey -- pra produto sem montagem
  // (needsAssembly=false) é o filamentId direto (mesma convenção de peça de
  // 1 filamento só); pra produto com montagem é o colorChoices inteiro
  // (Record<partId, comboKey>, ver actions/assembly.ts) serializado como
  // "partId:comboKey" ordenado e unido por "|" -- degenera pra um valor só
  // no caso comum (peça sintética ou produto de 1 peça), mas continua
  // correto pra produto composto de verdade com várias peças de cor
  // independente.
  key: string
  label: string
  quantity: number
  // Melhoria "Parceiros de consignação" §5: bolinha de cor no detalhe por
  // variante -- só preenchido quando a variante corresponde a EXATAMENTE 1
  // filamento (caso comum: peça de cor única ou peça sintética de produto
  // simples); nulo pra combo multi-filamento (peça com 2+ componentes ao
  // mesmo tempo), onde uma única cor não representaria a variante direito.
  colorHex: string | null
  // Melhoria "Modal de variações -- chips por hierarquia": mesma
  // informação de `label`, mas ESTRUTURADA (nome/valor/cor por atributo)
  // em vez de um texto único já concatenado -- pra telas que precisam
  // desenhar cada atributo como um chip separado (VariantsModal), com
  // peso visual diferente por hierarquia (`tier`). Vazio quando a
  // montagem é anterior ao rastreamento de colorChoices (mesmo caso em
  // que `label` também não existe pra essa variante).
  attrs: VariantAttr[]
}

// Peça (ProductPart) é a própria peça impressa que compõe o produto --
// hierarquia visual mais forte ("produto"); Product usado como componente
// (ex.: Mosquetão dentro de um chaveiro) é uma peça funcional que integra
// o produto mas não é ele mesmo -- hierarquia "complemento"; Accessory
// (ex.: Corrente) é só um item aplicado/trocável -- hierarquia mais
// discreta, "acessorio". Deriva do TIPO da fonte que resolveu o
// colorChoices (ver resolveChoiceAttr), nunca do NOME do atributo -- assim
// generaliza pra qualquer nome de peça/componente/acessório sem precisar
// de um mapa fixo por texto, e uma 4ª fonte futura (se existir) cai em
// "complemento" por padrão com segurança.
export type VariantAttrTier = 'produto' | 'complemento' | 'acessorio'

export interface VariantAttr {
  name: string
  value: string
  tier: VariantAttrTier
  // 1 elemento no caso comum (1 cor); 2 pra combo de peça multi-filamento
  // (ex.: "Lavanda + Roxo") -- só os 2 primeiros são usados na bolinha
  // dupla da UI, mesmo limite do protótipo original.
  colorHexes: string[]
}

const VARIANT_ATTR_TIER_RANK: Record<VariantAttrTier, number> = { produto: 0, complemento: 1, acessorio: 2 }

// Melhoria "Editar variação": exportada pra actions/assembly.ts também usar
// (encontrar quais ProductAssembly batem com o comboKey de uma variante
// mostrada em /stock, pra corrigir uma cor gravada errada) -- mesma lógica
// de serialização, nunca duplicada.
export function serializeColorChoices(choices: Record<string, string>): string {
  return Object.entries(choices)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([partId, comboKey]) => `${partId}:${comboKey}`)
    .join('|')
}

// Encomenda com variação personalizada: inverso de serializeColorChoices --
// decodifica o Order.colorComboKey de volta pro mapa { partId: comboKey }
// original, usado por maxAssemblableUnitsForCombo (lib/orderReservations.ts)
// pra saber qual combo cada peça precisa. comboKey em si pode conter ":"
// (nunca acontece hoje -- é um filamentId/cuid ou lista de cuids separada
// por vírgula -- mas o split cauteloso evita truncar se algum dia mudar).
export function deserializeColorChoices(key: string): Record<string, string> {
  return Object.fromEntries(
    key.split('|').map((pair) => {
      const [partId, ...rest] = pair.split(':')
      return [partId, rest.join(':')]
    }),
  )
}

// Ajuste "cor na montagem": quanto já foi montado de cada variante
// (combinação de cores escolhidas por peça, via ProductAssembly.
// colorChoices) -- puramente informativo/histórico. Como Sale/
// ConsignmentDelivery não diferenciam qual variante foi vendida/entregue,
// não dá pra calcular "disponível por variante" com segurança (só
// "produzido por variante" é sustentado pelos dados) -- nunca inventa
// esse número.
//
// Bug "cor no produto simples": `needsAssembly` decide a fonte --
// - true (composto, ou simples com insumo/acessório): lê
//   ProductAssembly.colorChoices, igual antes. Pra produto simples a
//   chave do combo é o próprio productId (ver
//   actions/assembly.ts#getAssemblyStatus), que não existe em
//   partNameById -- o label cai pro `else` abaixo e mostra só a cor, sem
//   prefixo de nome de peça (não faz sentido "peça" pra produto simples).
// - false (peça única sem nenhum componente, vai direto de Produção pro
//   estoque, nunca passa por ProductAssembly): "produzido" JÁ é o que
//   está em estoque, então a cor de cada lote (ProductionRun.filamentId)
//   é diretamente a variante em estoque -- sem "consumido" a descontar,
//   nada consome antes do estoque nesse caso.
export async function getProductVariantBreakdown(productId: string, needsAssembly: boolean): Promise<ProductVariantBreakdownRow[]> {
  if (!needsAssembly) {
    const runs = await prisma.productionRun.groupBy({
      by: ['filamentId'],
      where: { productId, productPartId: null, status: { not: 'CANCELADA' } },
      _sum: { quantitySuccess: true },
    })
    if (runs.length === 0) return []
    const filaments = await prisma.filament.findMany({ where: { id: { in: runs.map((r) => r.filamentId) } } })
    const filamentById = new Map(filaments.map((f) => [f.id, f]))
    return runs
      .map((r) => {
        const f = filamentById.get(r.filamentId)
        const label = f?.colorName ?? r.filamentId
        return {
          key: r.filamentId,
          label,
          quantity: r._sum.quantitySuccess ?? 0,
          colorHex: f?.colorHex ?? null,
          // Produto simples sem componente: a única variação é a cor dele
          // mesmo -- sempre hierarquia "produto" (é o produto em si, não um
          // complemento nem um acessório aplicado).
          attrs: [{ name: 'Cor', value: label, tier: 'produto' as const, colorHexes: f?.colorHex ? [f.colorHex] : [] }],
        }
      })
      .sort((a, b) => b.quantity - a.quantity)
  }

  const [assemblies, parts] = await Promise.all([
    prisma.productAssembly.findMany({ where: { productId }, orderBy: { assembledAt: 'asc' } }),
    prisma.productPart.findMany({ where: { productId } }),
  ])
  if (assemblies.length === 0) return []

  const partNameById = new Map(parts.map((p) => [p.id, p.name]))

  // Bug "cor com nome faltando": colorChoices pode ter 3 tipos de chave --
  // ProductPart.id (peça, já resolvido acima), Product.id (produto usado
  // como componente, ex. Mosquetão) ou Accessory.id (slot de acessório com
  // cor variável, ex. Corrente Bolinha) -- os 2 últimos não tinham nome
  // resolvido (mostrava a cor sem prefixo, ou pior, o cuid cru pro caso de
  // acessório). Resolve em lote: chaves que não são ProductPart viram
  // candidatas a Product OU Accessory (uma bate, a outra não). Valor
  // (rawKey) continua sendo um comboKey de filamentIds pra peça/
  // componente-produto (split(',') lê os dois formatos, ajuste "cor
  // multi-filamento na montagem"), mas pra acessório o rawKey É o
  // Accessory.id REALMENTE escolhido nesta leva -- resolvido à parte, sem
  // passar por filamento nenhum.
  const allKeys = new Set<string>()
  const allRawKeys = new Set<string>()
  for (const a of assemblies) {
    const choices = a.colorChoices as Record<string, string> | null
    if (!choices) continue
    for (const [key, rawKey] of Object.entries(choices)) {
      allKeys.add(key)
      allRawKeys.add(rawKey)
    }
  }
  // Exclui o próprio productId de "candidato a componente": produto
  // simples com insumo/acessório (peça sintética) usa o próprio id como
  // chave (actions/assembly.ts#getAssemblyStatus), que bateria com
  // prisma.product.findMany e mostraria "NomeDoProduto: Cor" em vez de só
  // "Cor" (comentário "Bug 'cor no produto simples'" abaixo) -- nunca faz
  // sentido prefixar a cor do próprio produto com o nome dele mesmo.
  const unresolvedKeys = [...allKeys].filter((k) => k !== productId && !partNameById.has(k))
  const filamentIdCandidates = new Set<string>()
  for (const rawKey of allRawKeys) for (const id of rawKey.split(',')) filamentIdCandidates.add(id)
  const accessoryIdCandidates = new Set([...unresolvedKeys, ...allRawKeys])

  const [filaments, componentProducts, accessories] = await Promise.all([
    filamentIdCandidates.size > 0 ? prisma.filament.findMany({ where: { id: { in: [...filamentIdCandidates] } } }) : Promise.resolve([]),
    unresolvedKeys.length > 0 ? prisma.product.findMany({ where: { id: { in: unresolvedKeys } } }) : Promise.resolve([]),
    accessoryIdCandidates.size > 0 ? prisma.accessory.findMany({ where: { id: { in: [...accessoryIdCandidates] } } }) : Promise.resolve([]),
  ])
  const filamentById = new Map(filaments.map((f) => [f.id, f]))
  const componentProductNameById = new Map(componentProducts.map((p) => [p.id, p.name]))
  const accessoryById = new Map(accessories.map((a) => [a.id, a]))

  function filamentComboLabel(rawKey: string): string {
    return rawKey.split(',').map((id) => filamentById.get(id)?.colorName ?? id).join(' + ')
  }

  function filamentComboHexes(rawKey: string): string[] {
    return rawKey.split(',').map((id) => filamentById.get(id)?.colorHex).filter((h): h is string => Boolean(h))
  }

  // Resolve UM par (choiceKey, rawKey) de colorChoices na sua fonte
  // estrutural -- ProductPart (peça), Product (componente) ou Accessory
  // (acessório com cor variável) -- usada tanto pra montar `label` (texto
  // único, formato antigo preservado) quanto `attrs` (chips por hierarquia,
  // ver VariantAttrTier acima). A hierarquia visual vem DAQUI, não de
  // combinar nomes num mapa fixo -- generaliza pra qualquer nome de peça/
  // componente/acessório.
  function resolveChoiceAttr(choiceKey: string, rawKey: string): VariantAttr {
    const partName = partNameById.get(choiceKey)
    if (partName) return { name: partName, value: filamentComboLabel(rawKey), tier: 'produto', colorHexes: filamentComboHexes(rawKey) }
    const componentName = componentProductNameById.get(choiceKey)
    if (componentName) return { name: componentName, value: filamentComboLabel(rawKey), tier: 'complemento', colorHexes: filamentComboHexes(rawKey) }
    const chosenAccessory = accessoryById.get(rawKey)
    if (chosenAccessory) {
      return {
        name: chosenAccessory.name,
        value: chosenAccessory.colorName ?? '',
        tier: 'acessorio',
        colorHexes: chosenAccessory.colorHex ? [chosenAccessory.colorHex] : [],
      }
    }
    return { name: '', value: filamentComboLabel(rawKey), tier: 'complemento', colorHexes: filamentComboHexes(rawKey) }
  }

  function attrToLegacyLabel(attr: VariantAttr): string {
    if (!attr.name) return attr.value
    if (attr.tier === 'acessorio') return attr.value ? `${attr.name} — ${attr.value}` : attr.name
    return `${attr.name}: ${attr.value}`
  }

  // Montagem sem colorChoices gravado (anterior ao ajuste de cor variável,
  // ou produto cujas peças nunca tiveram cor variável nenhuma) não entra
  // nessa quebra por variante -- não dá pra saber qual cor foi consumida
  // e "nunca inventa dado retroativamente" (ver comentário do topo desta
  // função). Essa quantidade continua contando normalmente em "Produzido"
  // (getOwnStockSummary, tabela principal de /stock), só não aparece
  // detalhada aqui.
  const totals = new Map<string, { label: string; quantity: number; colorHex: string | null; attrs: VariantAttr[] }>()
  for (const a of assemblies) {
    const choices = a.colorChoices as Record<string, string> | null
    if (!choices || Object.keys(choices).length === 0) continue
    const key = serializeColorChoices(choices)
    const resolvedAttrs = Object.entries(choices).map(([choiceKey, rawKey]) => resolveChoiceAttr(choiceKey, rawKey))
    const label = resolvedAttrs.map(attrToLegacyLabel).sort().join(', ')
    // Chips reordenados por hierarquia (Produto → Complemento → Acessório),
    // nunca alfabética como `label` acima -- é exatamente essa reordenação
    // que dá o agrupamento visual pedido (Base/Tampa antes de Corrente,
    // mesmo que o texto original venha em outra ordem).
    const attrs = [...resolvedAttrs].sort((x, y) => VARIANT_ATTR_TIER_RANK[x.tier] - VARIANT_ATTR_TIER_RANK[y.tier])
    // Bolinha de cor (usada por telas que só precisam de 1 cor por
    // variante): só quando a variante inteira se resolve num único valor
    // (1 peça/componente/acessório, sem multi-filamento) -- qualquer
    // combinação com mais de um valor não tem uma bolinha que a represente
    // direito.
    const choiceValues = Object.values(choices)
    const colorHex = choiceValues.length === 1 && !choiceValues[0].includes(',')
      ? (filamentById.get(choiceValues[0])?.colorHex ?? accessoryById.get(choiceValues[0])?.colorHex ?? null)
      : null
    const entry = totals.get(key) ?? { label, quantity: 0, colorHex, attrs }
    entry.quantity += a.quantity
    totals.set(key, entry)
  }

  return Array.from(totals.entries())
    .map(([key, { label, quantity, colorHex, attrs }]) => ({ key, label, quantity, colorHex, attrs }))
    .sort((a, b) => b.quantity - a.quantity)
}

export interface ProductVariantStockOption {
  key: string
  label: string
  colorHex: string | null
  available: number
  // Melhoria "Vendas: chips por peça/cor" -- mesmo dado estruturado que
  // getProductVariantBreakdown já produz (já usado por VariantsModal.tsx
  // em /stock), repassado aqui pra SaleForm.tsx/sales/page.tsx poderem
  // renderizar chips em vez de um texto corrido único.
  attrs: VariantAttr[]
}

export interface ProductVariantStockInfo {
  productId: string
  productName: string
  suggestedPrice: number | null
  // Vazio = produto sem variante conhecida (getProductVariantBreakdown não
  // achou nenhuma) -- o modal de entrega/venda pede só uma quantidade "sem
  // cor" nesse caso, sem oferecer combo nenhum.
  variants: ProductVariantStockOption[]
  // Encomenda com variação personalizada: Pedidos precisa oferecer
  // "+ Montar variação personalizada" pra produto que precisa de
  // montagem mesmo com `variants` vazio (nunca produzido/montado em
  // nenhuma cor ainda) -- só `variants.length > 0` não basta pra decidir
  // isso (ver OrderForm.tsx).
  needsAssembly: boolean
}

// Melhoria "Vendas por variante": generaliza o antigo getProductDeliveryOptions
// (que só alimentava o modal de Entregas) -- agora usado também pelo
// formulário de Venda direta, então "disponível" desconta os DOIS canais que
// consomem do mesmo estoque físico por cor: entregue em consignação
// (ConsignmentDelivery.colorComboKey) E vendido diretamente
// (Sale.colorComboKey, rastreável desde esta melhoria). Antes disso, Sale
// não rastreava cor -- o comentário antigo documentava essa limitação como
// aceita ("pode superestimar levemente"); com Sale.colorComboKey agora
// existindo, o cálculo fica exato pra vendas/entregas feitas a partir de
// agora (uma venda anterior a este ajuste, sem colorComboKey, não entra em
// nenhum combo específico -- nunca inventada retroativamente). Preço
// sugerido pré-preenche "Preço/Valor unitário" nos dois formulários,
// continua editável.
export async function getProductVariantStockOptions(): Promise<ProductVariantStockInfo[]> {
  // Brinde (isGift=true) nunca é vendido sozinho -- excluído deste
  // seletor (alimenta Vendas E Entregas de consignação), mesmo raciocínio
  // em getOwnStockSummary abaixo.
  const products = await prisma.product.findMany({
    where: { active: true, isGift: false },
    orderBy: { name: 'asc' },
    include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
  })
  if (products.length === 0) return []

  const [alreadyDelivered, alreadySold, alreadyReserved] = await Promise.all([
    prisma.consignmentDelivery.groupBy({ by: ['productId', 'colorComboKey'], _sum: { quantityDelivered: true } }),
    prisma.sale.groupBy({ by: ['productId', 'colorComboKey'], _sum: { quantity: true } }),
    // Melhoria "Pedidos com reserva de estoque": mesmo raciocínio de
    // getOwnStockSummary -- pedido não-terminal já reservou a variante
    // pra si, desconta de "available" abaixo.
    prisma.order.groupBy({ by: ['productId', 'colorComboKey'], where: { status: { notIn: ['ENTREGUE', 'CANCELADO'] } }, _sum: { reservedQuantity: true } }),
  ])
  const deliveredByProductAndKey = new Map<string, number>()
  for (const d of alreadyDelivered) {
    if (!d.colorComboKey) continue
    deliveredByProductAndKey.set(`${d.productId}::${d.colorComboKey}`, d._sum.quantityDelivered ?? 0)
  }
  const soldByProductAndKey = new Map<string, number>()
  for (const s of alreadySold) {
    if (!s.colorComboKey) continue
    soldByProductAndKey.set(`${s.productId}::${s.colorComboKey}`, s._sum.quantity ?? 0)
  }
  const reservedByProductAndKey = new Map<string, number>()
  for (const r of alreadyReserved) {
    if (!r.colorComboKey) continue
    reservedByProductAndKey.set(`${r.productId}::${r.colorComboKey}`, r._sum.reservedQuantity ?? 0)
  }

  return Promise.all(products.map(async (p) => {
    const needsAssembly = productNeedsAssembly({
      isComposite: p.isComposite,
      accessoryUsagesCount: p._count.accessoryUsages,
      supplyUsagesCount: p._count.supplyUsages,
      componentUsagesCount: p._count.componentUsages,
    })
    const breakdown = await getProductVariantBreakdown(p.id, needsAssembly)
    return {
      productId: p.id,
      productName: p.name,
      suggestedPrice: p.suggestedPrice?.toNumber() ?? null,
      needsAssembly,
      variants: breakdown.map((v) => ({
        key: v.key,
        label: v.label,
        colorHex: v.colorHex,
        available: Math.max(0, v.quantity - (deliveredByProductAndKey.get(`${p.id}::${v.key}`) ?? 0) - (soldByProductAndKey.get(`${p.id}::${v.key}`) ?? 0) - (reservedByProductAndKey.get(`${p.id}::${v.key}`) ?? 0)),
        attrs: v.attrs,
      })),
    }
  }))
}

export async function getOwnStockSummary(): Promise<OwnStockRow[]> {
  // Brinde nunca é produzido/estocado -- excluído (alimenta Estoque e
  // Dashboard).
  const [products, producedByProduct, assembledByProduct, soldByProduct, deliveries, openOrdersByProduct, reservedByProduct] = await Promise.all([
    prisma.product.findMany({
      where: { active: true, isGift: false },
      orderBy: { name: 'asc' },
      include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
    }),
    prisma.productionRun.groupBy({
      by: ['productId'],
      where: { productPartId: null, status: { not: 'CANCELADA' } },
      _sum: { quantitySuccess: true },
    }),
    prisma.productAssembly.groupBy({ by: ['productId'], _sum: { quantity: true } }),
    prisma.sale.groupBy({ by: ['productId'], _sum: { quantity: true } }),
    prisma.consignmentDelivery.findMany({ include: { saleReports: true } }),
    // ENTREGUE assumiu o papel de status terminal que CONCLUIDO tinha
    // (melhoria "Pedidos com reserva de estoque") -- CANCELADO é o outro
    // terminal, também fora da conta de "em produção".
    prisma.order.groupBy({ by: ['productId'], where: { status: { notIn: ['ENTREGUE', 'CANCELADO'] } }, _sum: { quantity: true } }),
    // Melhoria "Pedidos com reserva de estoque": peça já reservada por um
    // pedido não-terminal some do Disponível -- mesmo raciocínio de Sale/
    // ConsignmentDelivery, só que reservedQuantity é recalculado por
    // lib/orderReservations.ts#reconcileOrderReservations, não um fato
    // permanente gravado direto.
    prisma.order.groupBy({ by: ['productId'], where: { status: { notIn: ['ENTREGUE', 'CANCELADO'] } }, _sum: { reservedQuantity: true } }),
  ])

  // Melhoria "Produto-como-componente": quanto de cada produto já foi
  // consumido como INGREDIENTE de outro produto (ex.: Mosquetão consumido
  // pela montagem de Chaveiro Café) -- em lote, pra toda a listagem de uma
  // vez (não N+1), mesmo algoritmo de
  // actions/assembly.ts#getComponentColorAvailability, só que somando por
  // componentProductId direto (sem quebra por combo, que essa tela não
  // precisa). ProductComponentUsage é uma tabela pequena (poucos vínculos),
  // então buscar tudo de uma vez é barato.
  const [componentUsages, assembliesWithColorChoices] = await Promise.all([
    prisma.productComponentUsage.findMany(),
    prisma.productAssembly.findMany({ select: { productId: true, quantity: true, colorChoices: true } }),
  ])
  const usageByParentAndComponent = new Map<string, number>()
  for (const u of componentUsages) usageByParentAndComponent.set(`${u.productId}::${u.componentProductId}`, u.quantity)
  const consumedAsComponentMap = new Map<string, number>()
  for (const a of assembliesWithColorChoices) {
    const choices = a.colorChoices as Record<string, string> | null
    if (!choices) continue
    for (const key of Object.keys(choices)) {
      const quantityPerUnit = usageByParentAndComponent.get(`${a.productId}::${key}`)
      if (quantityPerUnit === undefined) continue // essa chave é uma ProductPart, não um componente-produto
      consumedAsComponentMap.set(key, (consumedAsComponentMap.get(key) ?? 0) + a.quantity * quantityPerUnit)
    }
  }

  // 2.6: ajustes de estoque de Product são o único termo que não tem uma
  // tabela própria pra somar -- StockAdjustment.difference (positivo ou
  // negativo) entra direto na fórmula de disponível.
  const productAdjustments = await prisma.stockAdjustment.groupBy({
    by: ['resourceId'],
    where: { resourceType: 'PRODUCT' },
    _sum: { difference: true },
  })
  const adjustmentMap = new Map(productAdjustments.map((a) => [a.resourceId, a._sum.difference?.toNumber() ?? 0]))

  const producedMap = new Map(producedByProduct.map((p) => [p.productId, p._sum.quantitySuccess ?? 0]))
  const assembledMap = new Map(assembledByProduct.map((a) => [a.productId, a._sum.quantity ?? 0]))
  const soldMap = new Map(soldByProduct.map((s) => [s.productId, s._sum.quantity ?? 0]))
  const openOrdersMap = new Map(openOrdersByProduct.map((o) => [o.productId, o._sum.quantity ?? 0]))
  const reservedMap = new Map(reservedByProduct.map((o) => [o.productId, o._sum.reservedQuantity ?? 0]))
  const deliveredMap = new Map<string, { delivered: number; consignmentSold: number }>()
  for (const d of deliveries) {
    const entry = deliveredMap.get(d.productId) ?? { delivered: 0, consignmentSold: 0 }
    entry.delivered += d.quantityDelivered
    entry.consignmentSold += d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
    deliveredMap.set(d.productId, entry)
  }

  return products.map((p) => {
    // Ajuste "produção → montagem → estoque": "produzido" só vem direto de
    // ProductionRun pro produto sem NENHUM componente (peça única) -- todo
    // produto que precisa de montagem (composto ou simples com insumo/
    // acessório) só soma ao estoque depois que a montagem for confirmada.
    const needsAssembly = productNeedsAssembly({
      isComposite: p.isComposite,
      accessoryUsagesCount: p._count.accessoryUsages,
      supplyUsagesCount: p._count.supplyUsages,
      componentUsagesCount: p._count.componentUsages,
    })
    const produced = needsAssembly ? (assembledMap.get(p.id) ?? 0) : (producedMap.get(p.id) ?? 0)
    const soldDirect = soldMap.get(p.id) ?? 0
    const delivery = deliveredMap.get(p.id) ?? { delivered: 0, consignmentSold: 0 }
    const adjustment = adjustmentMap.get(p.id) ?? 0
    const consumedAsComponent = consumedAsComponentMap.get(p.id) ?? 0
    const reserved = reservedMap.get(p.id) ?? 0
    return {
      productId: p.id,
      productName: p.name,
      isComposite: p.isComposite,
      needsAssembly,
      produced,
      soldDirect,
      deliveredToPartners: delivery.delivered,
      // Nunca negativo (bug de estoque/montagem): "disponível"/"em
      // consignação" são residuais derivados (produzido menos o que já
      // saiu) -- excluir uma ProductionRun já concluída (deleteProductionRun)
      // reduz "produced" retroativamente sem tocar Sale/ConsignmentDelivery
      // (fatos históricos, nunca reescritos), o que pode deixar o residual
      // abaixo de zero. Cada campo zera de forma independente (nunca
      // "empresta" o excedente de outro campo) -- é só isso, não um saldo
      // físico que precisa ser fisicamente descontado em cascata.
      consignmentRemaining: Math.max(0, delivery.delivered - delivery.consignmentSold),
      inProduction: openOrdersMap.get(p.id) ?? 0,
      consumedAsComponent,
      reserved,
      // Melhoria "Produto-como-componente": desconta também o que já foi
      // usado como ingrediente de outro produto -- sem isso, Mosquetão
      // continuaria aparecendo com estoque "disponível" mesmo depois de já
      // ter virado Chaveiro Café. Melhoria "Pedidos com reserva de
      // estoque": desconta também o que algum pedido não-terminal já
      // garantiu pra si (reservedQuantity, recalculado por
      // reconcileOrderReservations) -- sem isso, a mesma peça apareceria
      // como "disponível" pra vender de novo mesmo já estando prometida
      // a um pedido.
      available: Math.max(0, produced - soldDirect - delivery.delivered + adjustment - consumedAsComponent - reserved),
    }
  })
}

// Melhoria "Parceiros de consignação" §7: leve, só pra alimentar o card de
// cada parceiro na grade da lista ("10 itens com ela" / "Nenhum item em
// mãos") -- o detalhe completo (por produto/cor/histórico) fica em
// getConsignmentPartnerDetail, carregado só na página dedicada de cada
// parceiro (item 3), não na lista inteira de uma vez.
export interface ConsignmentPartnerListSummary {
  partnerId: string
  itemsWithPartner: number
}

export async function getConsignmentPartnerSummary(): Promise<ConsignmentPartnerListSummary[]> {
  const deliveries = await prisma.consignmentDelivery.findMany({
    where: { partner: { active: true } },
    select: { partnerId: true, quantityDelivered: true, saleReports: { select: { quantitySold: true } } },
  })
  const totals = new Map<string, number>()
  for (const d of deliveries) {
    const sold = d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
    totals.set(d.partnerId, (totals.get(d.partnerId) ?? 0) + Math.max(0, d.quantityDelivered - sold))
  }
  return [...totals.entries()].map(([partnerId, itemsWithPartner]) => ({ partnerId, itemsWithPartner }))
}

// Melhoria "Parceiros de consignação" §4/§5: tudo que a página dedicada de
// UM parceiro precisa -- resumo (itens com ela/total vendido/comissão a
// pagar), estoque agrupado por produto com quebra por variante de cor
// (delivered/sold/remaining POR combo, não só o total do produto) e, pra
// cada combo, os acessórios que aquela cor usa (ProductAccessoryColorUsage,
// puramente informativo, cadastrado na ficha técnica do Produto -- ver
// prisma/schema.prisma). Histórico cronológico com a cor de cada evento
// (cada entrega/venda É de uma cor específica, então não tem por que
// agrupar histórico por combo como o estoque).
export interface ConsignmentAccessoryChip {
  id: string
  name: string
  colorName: string
  colorHex: string | null
}

export interface ConsignmentVariantBreakdown {
  key: string | null // null = entregas sem cor registrada (produto sem variante, ou anteriores a este ajuste)
  label: string | null
  colorHex: string | null
  delivered: number
  sold: number
  remaining: number
  accessories: ConsignmentAccessoryChip[]
}

export interface ConsignmentProductBreakdown {
  productId: string
  productName: string
  delivered: number
  sold: number
  remaining: number
  variants: ConsignmentVariantBreakdown[]
}

export interface ConsignmentHistoryEvent {
  date: Date
  type: 'entrega' | 'venda'
  productName: string
  colorLabel: string | null
  quantity: number
}

// Melhoria "Parceiros de consignação": entrega individual com saldo > 0,
// candidata a receber um novo relatório de venda (mesma granularidade de
// ConsignmentSaleReport.deliveryId -- uma entrega específica, não o
// agregado por produto/cor que `products` acima mostra).
export interface ConsignmentSaleableDelivery {
  deliveryId: string
  productName: string
  colorLabel: string | null
  colorHex: string | null
  remaining: number
  // Preço cadastrado na entrega -- pré-preenche o campo editável de preço
  // unitário no modal "Registrar venda" (pedido "às vezes o valor é
  // diferente do cadastrado na parceria"), sem obrigar a sobrescrever
  // quando a venda foi pelo valor combinado de sempre.
  unitPrice: number
}

export interface ConsignmentPartnerDetail {
  partnerId: string
  partnerName: string
  defaultCommissionPercent: number
  notes: string | null
  itemsWithPartner: number
  totalSold: number
  commissionOwed: number
  products: ConsignmentProductBreakdown[]
  saleableDeliveries: ConsignmentSaleableDelivery[]
  history: ConsignmentHistoryEvent[]
}

export async function getConsignmentPartnerDetail(partnerId: string): Promise<ConsignmentPartnerDetail | null> {
  const partner = await prisma.consignmentPartner.findUnique({
    where: { id: partnerId },
    include: {
      deliveries: {
        include: { product: true, saleReports: true },
        orderBy: { deliveryDate: 'desc' },
      },
    },
  })
  if (!partner) return null

  // Rótulo de cada colorComboKey já usado nas entregas deste parceiro --
  // reaproveita a mesma quebra de variante que /stock já mostra
  // (getProductVariantBreakdown), pra "Rosa"/"Azul" aqui serem exatamente a
  // mesma cor que aparece em Estoque, nunca um rótulo inventado à parte.
  const productIds = [...new Set(partner.deliveries.map((d) => d.productId))]
  const products = productIds.length > 0 ? await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
  }) : []
  const variantInfoByProductAndKey = new Map<string, { label: string; colorHex: string | null }>()
  await Promise.all(products.map(async (p) => {
    const needsAssembly = productNeedsAssembly({
      isComposite: p.isComposite,
      accessoryUsagesCount: p._count.accessoryUsages,
      supplyUsagesCount: p._count.supplyUsages,
      componentUsagesCount: p._count.componentUsages,
    })
    const breakdown = await getProductVariantBreakdown(p.id, needsAssembly)
    for (const v of breakdown) variantInfoByProductAndKey.set(`${p.id}::${v.key}`, { label: v.label, colorHex: v.colorHex })
  }))

  // Acessórios por combo: só busca pros pares (productId, colorComboKey)
  // que de fato aparecem nas entregas deste parceiro.
  const comboPairs = [...new Set(
    partner.deliveries.filter((d) => d.colorComboKey).map((d) => `${d.productId}::${d.colorComboKey}`),
  )]
  const accessoryColorUsages = comboPairs.length > 0 ? await prisma.productAccessoryColorUsage.findMany({
    where: { OR: comboPairs.map((pair) => { const [productId, colorComboKey] = pair.split('::'); return { productId, colorComboKey } }) },
    include: { accessory: true },
  }) : []
  const accessoriesByComboPair = new Map<string, ConsignmentAccessoryChip[]>()
  for (const u of accessoryColorUsages) {
    const pairKey = `${u.productId}::${u.colorComboKey}`
    const list = accessoriesByComboPair.get(pairKey) ?? []
    list.push({ id: u.accessory.id, name: u.accessory.name, colorName: u.accessory.colorName, colorHex: u.accessory.colorHex })
    accessoriesByComboPair.set(pairKey, list)
  }

  const byProduct = new Map<string, { productName: string; delivered: number; sold: number; variants: Map<string, { key: string | null; delivered: number; sold: number }> }>()
  const history: ConsignmentHistoryEvent[] = []
  let totalSold = 0
  let commissionOwed = 0

  const saleableDeliveries: ConsignmentSaleableDelivery[] = []

  for (const delivery of partner.deliveries) {
    const variantKey = delivery.colorComboKey
    const variantInfo = variantKey ? variantInfoByProductAndKey.get(`${delivery.productId}::${variantKey}`) : undefined
    const colorLabel = variantKey ? (variantInfo?.label ?? null) : null

    const deliverySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
    const deliveryRemaining = Math.max(0, delivery.quantityDelivered - deliverySold)
    if (deliveryRemaining > 0) {
      saleableDeliveries.push({
        deliveryId: delivery.id,
        productName: delivery.product.name,
        colorLabel,
        colorHex: variantInfo?.colorHex ?? null,
        remaining: deliveryRemaining,
        unitPrice: delivery.unitPrice.toNumber(),
      })
    }

    const product = byProduct.get(delivery.productId) ?? { productName: delivery.product.name, delivered: 0, sold: 0, variants: new Map() }
    product.delivered += delivery.quantityDelivered
    const variantMapKey = variantKey ?? '__none__'
    const variant = product.variants.get(variantMapKey) ?? { key: variantKey, delivered: 0, sold: 0 }
    variant.delivered += delivery.quantityDelivered

    history.push({ date: delivery.deliveryDate, type: 'entrega', productName: delivery.product.name, colorLabel, quantity: delivery.quantityDelivered })

    for (const report of delivery.saleReports) {
      product.sold += report.quantitySold
      variant.sold += report.quantitySold
      totalSold += report.quantitySold
      const reportUnitPrice = report.unitPrice?.toNumber() ?? delivery.unitPrice.toNumber()
      commissionOwed += report.quantitySold * reportUnitPrice * report.commissionPercent.toNumber()
      history.push({ date: report.reportDate, type: 'venda', productName: delivery.product.name, colorLabel, quantity: report.quantitySold })
    }

    product.variants.set(variantMapKey, variant)
    byProduct.set(delivery.productId, product)
  }

  history.sort((a, b) => b.date.getTime() - a.date.getTime())

  const productsBreakdown: ConsignmentProductBreakdown[] = [...byProduct.entries()].map(([productId, { productName, delivered, sold, variants }]) => ({
    productId,
    productName,
    delivered,
    sold,
    remaining: Math.max(0, delivered - sold),
    variants: [...variants.values()].map((v) => ({
      key: v.key,
      label: v.key ? (variantInfoByProductAndKey.get(`${productId}::${v.key}`)?.label ?? v.key) : null,
      colorHex: v.key ? (variantInfoByProductAndKey.get(`${productId}::${v.key}`)?.colorHex ?? null) : null,
      delivered: v.delivered,
      sold: v.sold,
      remaining: Math.max(0, v.delivered - v.sold),
      accessories: v.key ? (accessoriesByComboPair.get(`${productId}::${v.key}`) ?? []) : [],
    })),
  }))

  const itemsWithPartner = productsBreakdown.reduce((sum, p) => sum + p.remaining, 0)

  return {
    partnerId: partner.id,
    partnerName: partner.name,
    defaultCommissionPercent: partner.defaultCommissionPercent.toNumber(),
    notes: partner.notes,
    itemsWithPartner,
    totalSold,
    commissionOwed,
    products: productsBreakdown,
    saleableDeliveries,
    history,
  }
}

export async function getConsignmentStockSummary() {
  const deliveries = await prisma.consignmentDelivery.findMany({
    include: { partner: true, product: true, saleReports: true },
  })
  return deliveries
    .map((d) => {
      const unitPrice = d.unitPrice.toNumber()
      const remaining = d.quantityDelivered - d.saleReports.reduce((s, r) => s + r.quantitySold, 0)
      return {
        partnerName: d.partner.name,
        productName: d.product.name,
        remaining,
        // Dashboard "Peças em consignação": pedido "mostre o valor em
        // consignado junto à quantidade" -- valor do que ainda está com o
        // parceiro (não vendido), pelo preço cadastrado na entrega.
        remainingValue: remaining * unitPrice,
      }
    })
    .filter((d) => d.remaining > 0)
}

// Dashboard: pedido "mostre o valor total de vendas somente o que já foi
// realmente vendido" -- soma direto de ConsignmentSaleReport (venda de
// verdade já registrada), nunca de entregas/estoque com o parceiro.
// unitPrice segue a mesma convenção de getConsignmentRevenue (preço da
// própria venda quando sobrescrito, senão o da entrega); valor BRUTO (antes
// da comissão do parceiro), pra comparar com "Peças em consignação" na
// mesma base (preço cheio), diferente do "Consignação" da Receita total
// (que é líquido, depois de descontar comissão -- o que a loja de fato
// embolsa).
export async function getConsignmentSoldSummary(): Promise<{ totalUnitsSold: number; totalGrossValue: number }> {
  const reports = await prisma.consignmentSaleReport.findMany({ include: { delivery: true } })
  let totalUnitsSold = 0
  let totalGrossValue = 0
  for (const r of reports) {
    const unitPrice = r.unitPrice?.toNumber() ?? r.delivery.unitPrice.toNumber()
    totalUnitsSold += r.quantitySold
    totalGrossValue += r.quantitySold * unitPrice
  }
  return { totalUnitsSold, totalGrossValue }
}
