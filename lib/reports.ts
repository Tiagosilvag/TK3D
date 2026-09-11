import { prisma } from '@/lib/prisma'
import { getStockStatus, type ProductionCostSnapshot } from '@/lib/costing'
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
    select: { currentStockGrams: true, initialStockGrams: true },
  })
  return filaments.filter((f) => {
    const initial = f.initialStockGrams.toNumber()
    const current = f.currentStockGrams.toNumber()
    const percentRemaining = initial > 0 ? (current / initial) * 100 : 0
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
    const unitPrice = r.delivery.unitPrice.toNumber()
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
}

function serializeColorChoices(choices: Record<string, string>): string {
  return Object.entries(choices)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([partId, comboKey]) => `${partId}:${comboKey}`)
    .join('|')
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
      .map((r) => ({
        key: r.filamentId,
        label: filamentById.get(r.filamentId)?.colorName ?? r.filamentId,
        quantity: r._sum.quantitySuccess ?? 0,
        colorHex: filamentById.get(r.filamentId)?.colorHex ?? null,
      }))
      .sort((a, b) => b.quantity - a.quantity)
  }

  const [assemblies, parts] = await Promise.all([
    prisma.productAssembly.findMany({ where: { productId }, orderBy: { assembledAt: 'asc' } }),
    prisma.productPart.findMany({ where: { productId } }),
  ])
  if (assemblies.length === 0) return []

  const partNameById = new Map(parts.map((p) => [p.id, p.name]))
  // Ajuste "cor multi-filamento na montagem": cada valor de colorChoices
  // agora é um comboKey (1+ filamentIds unidos por vírgula, ver
  // actions/assembly.ts#AssemblyPartColorOption) -- dado antigo (peça de
  // 1 filamento só) já era literalmente o filamentId sozinho, então
  // split(',') lê os dois formatos sem distinção.
  const filamentIds = new Set<string>()
  for (const a of assemblies) {
    const choices = a.colorChoices as Record<string, string> | null
    if (choices) for (const rawKey of Object.values(choices)) for (const id of rawKey.split(',')) filamentIds.add(id)
  }
  const filaments = filamentIds.size > 0 ? await prisma.filament.findMany({ where: { id: { in: [...filamentIds] } } }) : []
  const filamentById = new Map(filaments.map((f) => [f.id, f]))

  // Montagem sem colorChoices gravado (anterior ao ajuste de cor variável,
  // ou produto cujas peças nunca tiveram cor variável nenhuma) não entra
  // nessa quebra por variante -- não dá pra saber qual cor foi consumida
  // e "nunca inventa dado retroativamente" (ver comentário do topo desta
  // função). Essa quantidade continua contando normalmente em "Produzido"
  // (getOwnStockSummary, tabela principal de /stock), só não aparece
  // detalhada aqui.
  const totals = new Map<string, { label: string; quantity: number; colorHex: string | null }>()
  for (const a of assemblies) {
    const choices = a.colorChoices as Record<string, string> | null
    if (!choices || Object.keys(choices).length === 0) continue
    const key = serializeColorChoices(choices)
    const label = Object.entries(choices)
      .map(([partId, rawKey]) => {
        const colorNames = rawKey.split(',').map((id) => filamentById.get(id)?.colorName ?? id)
        const colorLabel = colorNames.join(' + ')
        const partName = partNameById.get(partId)
        return partName ? `${partName}: ${colorLabel}` : colorLabel
      })
      .sort()
      .join(', ')
    // Bolinha de cor: só quando a variante inteira se resolve num único
    // filamento (1 peça, sem multi-filamento) -- qualquer combinação com
    // mais de uma cor não tem uma bolinha que a represente direito.
    const choiceValues = Object.values(choices)
    const colorHex = choiceValues.length === 1 && !choiceValues[0].includes(',')
      ? (filamentById.get(choiceValues[0])?.colorHex ?? null)
      : null
    const entry = totals.get(key) ?? { label, quantity: 0, colorHex }
    entry.quantity += a.quantity
    totals.set(key, entry)
  }

  return Array.from(totals.entries())
    .map(([key, { label, quantity, colorHex }]) => ({ key, label, quantity, colorHex }))
    .sort((a, b) => b.quantity - a.quantity)
}

export interface ProductDeliveryVariantOption {
  key: string
  label: string
  colorHex: string | null
  available: number
}

export interface ProductDeliveryOption {
  productId: string
  productName: string
  suggestedPrice: number | null
  // Vazio = produto sem variante conhecida (getProductVariantBreakdown não
  // achou nenhuma) -- o modal de entrega pede só uma quantidade "sem cor"
  // nesse caso, sem oferecer combo nenhum.
  variants: ProductDeliveryVariantOption[]
}

// Melhoria "Entregas em consignação" §3/§6: pra cada produto ativo, suas
// variantes de cor já produzidas/montadas (getProductVariantBreakdown) com
// "disponível" = produzido menos o que já foi entregue em consignação
// daquela cor (agora rastreável via ConsignmentDelivery.colorComboKey,
// desde a melhoria "Parceiros de consignação"). Aproximação: NÃO desconta
// venda direta (Sale) por variante, porque Sale continua sem rastrear cor
// (mesma limitação documentada em getProductVariantBreakdown) -- pode
// superestimar levemente o disponível de um produto com venda direta
// recente da mesma cor, mas é a mesma fonte confiável ("produzido por
// variante") que o resto do app já usa, nunca um número inventado. Preço
// sugerido pré-preenche "Preço unitário" no modal (item 6), continua
// editável por linha.
export async function getProductDeliveryOptions(): Promise<ProductDeliveryOption[]> {
  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    include: { _count: { select: { accessoryUsages: true, supplyUsages: true } } },
  })
  if (products.length === 0) return []

  const alreadyDelivered = await prisma.consignmentDelivery.groupBy({
    by: ['productId', 'colorComboKey'],
    _sum: { quantityDelivered: true },
  })
  const deliveredByProductAndKey = new Map<string, number>()
  for (const d of alreadyDelivered) {
    if (!d.colorComboKey) continue
    deliveredByProductAndKey.set(`${d.productId}::${d.colorComboKey}`, d._sum.quantityDelivered ?? 0)
  }

  return Promise.all(products.map(async (p) => {
    const needsAssembly = productNeedsAssembly({
      isComposite: p.isComposite,
      accessoryUsagesCount: p._count.accessoryUsages,
      supplyUsagesCount: p._count.supplyUsages,
    })
    const breakdown = await getProductVariantBreakdown(p.id, needsAssembly)
    return {
      productId: p.id,
      productName: p.name,
      suggestedPrice: p.suggestedPrice?.toNumber() ?? null,
      variants: breakdown.map((v) => ({
        key: v.key,
        label: v.label,
        colorHex: v.colorHex,
        available: Math.max(0, v.quantity - (deliveredByProductAndKey.get(`${p.id}::${v.key}`) ?? 0)),
      })),
    }
  }))
}

export async function getOwnStockSummary(): Promise<OwnStockRow[]> {
  const [products, producedByProduct, assembledByProduct, soldByProduct, deliveries, openOrdersByProduct] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { accessoryUsages: true, supplyUsages: true } } },
    }),
    prisma.productionRun.groupBy({
      by: ['productId'],
      where: { productPartId: null, status: { not: 'CANCELADA' } },
      _sum: { quantitySuccess: true },
    }),
    prisma.productAssembly.groupBy({ by: ['productId'], _sum: { quantity: true } }),
    prisma.sale.groupBy({ by: ['productId'], _sum: { quantity: true } }),
    prisma.consignmentDelivery.findMany({ include: { saleReports: true } }),
    prisma.order.groupBy({ by: ['productId'], where: { status: { not: 'CONCLUIDO' } }, _sum: { quantity: true } }),
  ])

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
    })
    const produced = needsAssembly ? (assembledMap.get(p.id) ?? 0) : (producedMap.get(p.id) ?? 0)
    const soldDirect = soldMap.get(p.id) ?? 0
    const delivery = deliveredMap.get(p.id) ?? { delivered: 0, consignmentSold: 0 }
    const adjustment = adjustmentMap.get(p.id) ?? 0
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
      available: Math.max(0, produced - soldDirect - delivery.delivered + adjustment),
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

export interface ConsignmentPartnerDetail {
  partnerId: string
  partnerName: string
  defaultCommissionPercent: number
  notes: string | null
  itemsWithPartner: number
  totalSold: number
  commissionOwed: number
  products: ConsignmentProductBreakdown[]
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
    include: { _count: { select: { accessoryUsages: true, supplyUsages: true } } },
  }) : []
  const variantInfoByProductAndKey = new Map<string, { label: string; colorHex: string | null }>()
  await Promise.all(products.map(async (p) => {
    const needsAssembly = productNeedsAssembly({
      isComposite: p.isComposite,
      accessoryUsagesCount: p._count.accessoryUsages,
      supplyUsagesCount: p._count.supplyUsages,
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

  for (const delivery of partner.deliveries) {
    const variantKey = delivery.colorComboKey
    const colorLabel = variantKey ? (variantInfoByProductAndKey.get(`${delivery.productId}::${variantKey}`)?.label ?? null) : null

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
      commissionOwed += report.quantitySold * delivery.unitPrice.toNumber() * report.commissionPercent.toNumber()
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
    history,
  }
}

export async function getConsignmentStockSummary() {
  const deliveries = await prisma.consignmentDelivery.findMany({
    include: { partner: true, product: true, saleReports: true },
  })
  return deliveries
    .map((d) => ({
      partnerName: d.partner.name,
      productName: d.product.name,
      remaining: d.quantityDelivered - d.saleReports.reduce((s, r) => s + r.quantitySold, 0),
    }))
    .filter((d) => d.remaining > 0)
}
