// Melhoria "Estoque › Variações com rastreio total": o modal de Variações
// (/stock) só mostrava uma tabela larga por peça e um log plano de
// eventos -- não dava pra responder "dos N montados, quantos estão onde,
// com qual parceiro, vendidos quando/por quanto". Em vez de criar uma
// tabela-ledger nova que toda ação (produzir/montar/entregar/vender/
// devolver) passaria a escrever -- o que duplicaria as tabelas que já
// existem e contraria CLAUDE.md ("Estoque derivado, não contador
// redundante") -- este módulo DERIVA a trilha por unidade das próprias
// tabelas transacionais (ProductAssembly/ProductionRun, ConsignmentDelivery,
// ConsignmentSaleReport, Sale), sem nenhum dado novo além de
// ConsignmentDelivery.lastReturnedAt (só a data da devolução, que não
// existia em lugar nenhum).
//
// Como funciona: cada unidade física acabada não tem identidade própria
// no banco (estoque é só quantidade) -- então ela é reconstruída por
// FIFO. Todo evento relevante de UM produto (montagem/produção,
// entregas, devoluções, vendas consignadas, vendas diretas) é ordenado
// cronologicamente numa fila só, e processado em sequência: "montagem"
// cria unidades virtuais numeradas (iam entrando num pool "em estoque");
// "entrega" tira as N mais antigas desse pool e move pro pool daquela
// entrega específica; "devolução" tira as N mais antigas do pool da
// entrega e devolve pro pool de estoque (marcadas "já devolvida" --
// distingue de uma unidade "virgem", nunca entregue); "venda consignada"
// tira as N mais antigas do pool daquela entrega e marca vendida
// (terminal); "venda direta" tira as N mais antigas do pool de estoque e
// marca vendida. Isso é EXATAMENTE o mesmo raciocínio que
// reverseExcessAssemblyForRun/updateAssemblyColorChoices (actions/
// assembly.ts) já usam pra "consumir o mais antigo primeiro" -- só
// generalizado pra uma fila por produto inteira, incluindo entrega/venda,
// em vez de só montagem.
//
// Limitação aceita (documentada): ConsignmentDelivery.returnedQuantity é
// um contador único, não um log por devolução parcial -- se a MESMA
// entrega foi devolvida em pedaços, em datas diferentes, todas essas
// unidades aparecem com a data da ÚLTIMA devolução (lastReturnedAt).
// Ajustes manuais de estoque (StockAdjustment, resourceType=PRODUCT) não
// são atribuíveis a uma variante/unidade específica (o próprio ajuste
// não guarda isso) -- entram só na nota de reconciliação, nunca viram
// uma unidade virtual fake.
import { prisma } from '@/lib/prisma'
import { getProductVariantBreakdown, serializeColorChoices, type VariantAttr } from '@/lib/reports'
import { productNeedsAssembly } from '@/lib/products'
import { getAssemblyStatus } from '@/actions/assembly'
import { getProductAverageProductionCost } from '@/actions/products'
import { formatCurrency } from '@/lib/format'

export type UnitLocationType = 'estoque' | 'devolvida' | 'parceiro' | 'vendida'

export type UnitLocation =
  | { type: 'estoque' }
  | { type: 'devolvida' }
  | { type: 'parceiro'; partnerId: string; partnerName: string; since: string }
  | { type: 'vendida'; via: 'consignado' | 'direta'; partnerName: string | null; date: string; unitPrice: number }

export type UnitStepLink =
  | { type: 'delivery'; deliveryId: string }
  | { type: 'consignmentSale'; saleReportId: string }
  | { type: 'directSale'; saleId: string }

export interface UnitTrailStep {
  kind: 'montado' | 'produzido' | 'entregue' | 'vendido' | 'devolvido'
  date: string
  label: string
  detail: string | null
  link: UnitStepLink | null
}

export interface ProductUnit {
  n: number
  comboKey: string
  variantLabel: string
  colorHexes: string[]
  location: UnitLocation
  steps: UnitTrailStep[]
}

export interface VariantPartnerCount {
  partnerId: string
  partnerName: string
  quantity: number
}

export interface VariantTrailRow {
  comboKey: string
  label: string
  colorHexes: string[]
  attrs: VariantAttr[]
  inStock: number
  withPartners: VariantPartnerCount[]
  sold: number
  total: number
}

export interface PartLotSummary {
  name: string
  produced: number
  consumed: number
  available: number
}

export interface HistoryEntry {
  date: string
  kind: 'Produzido' | 'Montado' | 'Entregue' | 'Vendido' | 'Devolvido'
  detail: string
  link: UnitStepLink | null
}

export interface ProductUnitTrailResult {
  productId: string
  productName: string
  isComposite: boolean
  needsAssembly: boolean
  totalCreated: number
  locationCounts: {
    inStock: number
    withPartners: VariantPartnerCount[]
    sold: number
    returned: number
  }
  reconciliationOk: boolean
  reconciliationNote: string | null
  units: ProductUnit[]
  variantRows: VariantTrailRow[]
  parts: PartLotSummary[]
  history: HistoryEntry[]
}

function formatDiaMes(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

interface QueueUnit {
  n: number
  comboKey: string
  everReturned: boolean
  steps: UnitTrailStep[]
  location: UnitLocation
}

function takeOldest(queue: QueueUnit[], qty: number): QueueUnit[] {
  return queue.splice(0, Math.min(qty, queue.length))
}

type RawEvent =
  | { kind: 'ASSEMBLED'; date: Date; prio: number; comboKey: string; qty: number }
  | { kind: 'DELIVERED'; date: Date; prio: number; comboKey: string; qty: number; deliveryId: string; partnerId: string; partnerName: string }
  | { kind: 'RETURNED'; date: Date; prio: number; deliveryId: string; qty: number }
  | { kind: 'SOLD_CONSIGNED'; date: Date; prio: number; deliveryId: string; qty: number; saleReportId: string; unitPrice: number; partnerName: string }
  | { kind: 'SOLD_DIRECT'; date: Date; prio: number; comboKey: string; qty: number; saleId: string; unitPrice: number }

const KIND_PRIORITY: Record<RawEvent['kind'], number> = {
  ASSEMBLED: 0,
  DELIVERED: 1,
  RETURNED: 2,
  SOLD_CONSIGNED: 3,
  SOLD_DIRECT: 3,
}

export async function getProductUnitTrail(productId: string): Promise<ProductUnitTrailResult> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
  })
  const needsAssembly = productNeedsAssembly({
    isComposite: product.isComposite,
    accessoryUsagesCount: product._count.accessoryUsages,
    supplyUsagesCount: product._count.supplyUsages,
    componentUsagesCount: product._count.componentUsages,
  })

  const [variantBreakdown, deliveries, sales] = await Promise.all([
    getProductVariantBreakdown(productId, needsAssembly),
    prisma.consignmentDelivery.findMany({
      where: { productId },
      include: { partner: true, saleReports: true },
      orderBy: { deliveryDate: 'asc' },
    }),
    prisma.sale.findMany({ where: { productId }, orderBy: { saleDate: 'asc' } }),
  ])
  const variantInfoByKey = new Map(variantBreakdown.map((v) => [v.key, v]))

  const events: RawEvent[] = []

  if (needsAssembly) {
    const assemblies = await prisma.productAssembly.findMany({ where: { productId }, orderBy: { assembledAt: 'asc' } })
    for (const a of assemblies) {
      const choices = a.colorChoices as Record<string, string> | null
      if (!choices || Object.keys(choices).length === 0) continue
      events.push({ kind: 'ASSEMBLED', date: a.assembledAt, prio: KIND_PRIORITY.ASSEMBLED, comboKey: serializeColorChoices(choices), qty: a.quantity })
    }
  } else {
    const runs = await prisma.productionRun.findMany({
      where: { productId, productPartId: null, status: { not: 'CANCELADA' } },
      orderBy: { date: 'asc' },
    })
    for (const r of runs) {
      if (r.quantitySuccess <= 0) continue
      events.push({ kind: 'ASSEMBLED', date: r.date, prio: KIND_PRIORITY.ASSEMBLED, comboKey: r.filamentId, qty: r.quantitySuccess })
    }
  }

  for (const d of deliveries) {
    if (!d.colorComboKey) continue
    events.push({
      kind: 'DELIVERED',
      date: d.deliveryDate,
      prio: KIND_PRIORITY.DELIVERED,
      comboKey: d.colorComboKey,
      qty: d.quantityDelivered,
      deliveryId: d.id,
      partnerId: d.partnerId,
      partnerName: d.partner.name,
    })
    if (d.returnedQuantity > 0) {
      events.push({ kind: 'RETURNED', date: d.lastReturnedAt ?? d.deliveryDate, prio: KIND_PRIORITY.RETURNED, deliveryId: d.id, qty: d.returnedQuantity })
    }
    for (const r of d.saleReports) {
      events.push({
        kind: 'SOLD_CONSIGNED',
        date: r.reportDate,
        prio: KIND_PRIORITY.SOLD_CONSIGNED,
        deliveryId: d.id,
        qty: r.quantitySold,
        saleReportId: r.id,
        unitPrice: (r.unitPrice ?? d.unitPrice).toNumber(),
        partnerName: d.partner.name,
      })
    }
  }

  for (const s of sales) {
    if (!s.colorComboKey) continue
    events.push({
      kind: 'SOLD_DIRECT',
      date: s.saleDate,
      prio: KIND_PRIORITY.SOLD_DIRECT,
      comboKey: s.colorComboKey,
      qty: s.quantity,
      saleId: s.id,
      unitPrice: s.unitPrice.toNumber(),
    })
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.prio - b.prio)

  const stockQueueByCombo = new Map<string, QueueUnit[]>()
  const deliveryQueue = new Map<string, QueueUnit[]>()
  const soldUnits: QueueUnit[] = []
  const history: HistoryEntry[] = []
  let nextN = 1
  let shortfall = 0

  function variantLabel(comboKey: string): string {
    return variantInfoByKey.get(comboKey)?.label ?? comboKey
  }
  function variantColorHexes(comboKey: string): string[] {
    const info = variantInfoByKey.get(comboKey)
    if (!info) return []
    return info.attrs.length > 0 ? info.attrs.flatMap((a) => a.colorHexes).slice(0, 2) : (info.colorHex ? [info.colorHex] : [])
  }

  for (const ev of events) {
    if (ev.kind === 'ASSEMBLED') {
      const queue = stockQueueByCombo.get(ev.comboKey) ?? []
      for (let i = 0; i < ev.qty; i++) {
        const step: UnitTrailStep = {
          kind: needsAssembly ? 'montado' : 'produzido',
          date: ev.date.toISOString(),
          label: needsAssembly ? 'Montado' : 'Produzido',
          detail: formatDiaMes(ev.date),
          link: null,
        }
        queue.push({ n: nextN++, comboKey: ev.comboKey, everReturned: false, steps: [step], location: { type: 'estoque' } })
      }
      stockQueueByCombo.set(ev.comboKey, queue)
      history.push({
        date: ev.date.toISOString(),
        kind: needsAssembly ? 'Montado' : 'Produzido',
        detail: `${ev.qty}x ${variantLabel(ev.comboKey)}`,
        link: null,
      })
      continue
    }

    if (ev.kind === 'DELIVERED') {
      const queue = stockQueueByCombo.get(ev.comboKey) ?? []
      const taken = takeOldest(queue, ev.qty)
      if (taken.length < ev.qty) shortfall += ev.qty - taken.length
      const dq = deliveryQueue.get(ev.deliveryId) ?? []
      for (const unit of taken) {
        unit.location = { type: 'parceiro', partnerId: ev.partnerId, partnerName: ev.partnerName, since: ev.date.toISOString() }
        unit.steps.push({
          kind: 'entregue',
          date: ev.date.toISOString(),
          label: `Entregue · ${ev.partnerName}`,
          detail: formatDiaMes(ev.date),
          link: { type: 'delivery', deliveryId: ev.deliveryId },
        })
        dq.push(unit)
      }
      deliveryQueue.set(ev.deliveryId, dq)
      history.push({
        date: ev.date.toISOString(),
        kind: 'Entregue',
        detail: `${ev.qty}x ${variantLabel(ev.comboKey)} → ${ev.partnerName}`,
        link: { type: 'delivery', deliveryId: ev.deliveryId },
      })
      continue
    }

    if (ev.kind === 'RETURNED') {
      const dq = deliveryQueue.get(ev.deliveryId) ?? []
      const taken = takeOldest(dq, ev.qty)
      if (taken.length < ev.qty) shortfall += ev.qty - taken.length
      for (const unit of taken) {
        unit.everReturned = true
        unit.location = { type: 'devolvida' }
        unit.steps.push({ kind: 'devolvido', date: ev.date.toISOString(), label: 'Devolvida', detail: formatDiaMes(ev.date), link: null })
        const stockQueue = stockQueueByCombo.get(unit.comboKey) ?? []
        stockQueue.push(unit)
        stockQueueByCombo.set(unit.comboKey, stockQueue)
      }
      if (taken.length > 0) {
        history.push({ date: ev.date.toISOString(), kind: 'Devolvido', detail: `${taken.length}x devolvida(s) ao estoque`, link: { type: 'delivery', deliveryId: ev.deliveryId } })
      }
      continue
    }

    if (ev.kind === 'SOLD_CONSIGNED') {
      const dq = deliveryQueue.get(ev.deliveryId) ?? []
      const taken = takeOldest(dq, ev.qty)
      if (taken.length < ev.qty) shortfall += ev.qty - taken.length
      for (const unit of taken) {
        unit.location = { type: 'vendida', via: 'consignado', partnerName: ev.partnerName, date: ev.date.toISOString(), unitPrice: ev.unitPrice }
        unit.steps.push({
          kind: 'vendido',
          date: ev.date.toISOString(),
          label: `Vendida · ${ev.partnerName}`,
          detail: `${formatDiaMes(ev.date)} · ${formatCurrency(ev.unitPrice)}`,
          link: { type: 'consignmentSale', saleReportId: ev.saleReportId },
        })
        soldUnits.push(unit)
      }
      if (taken.length > 0) {
        history.push({
          date: ev.date.toISOString(),
          kind: 'Vendido',
          detail: `${taken.length}x vendida(s) · ${ev.partnerName} · ${formatCurrency(ev.unitPrice)}`,
          link: { type: 'consignmentSale', saleReportId: ev.saleReportId },
        })
      }
      continue
    }

    // SOLD_DIRECT
    const queue = stockQueueByCombo.get(ev.comboKey) ?? []
    const taken = takeOldest(queue, ev.qty)
    if (taken.length < ev.qty) shortfall += ev.qty - taken.length
    for (const unit of taken) {
      unit.location = { type: 'vendida', via: 'direta', partnerName: null, date: ev.date.toISOString(), unitPrice: ev.unitPrice }
      unit.steps.push({
        kind: 'vendido',
        date: ev.date.toISOString(),
        label: 'Vendida (direta)',
        detail: `${formatDiaMes(ev.date)} · ${formatCurrency(ev.unitPrice)}`,
        link: { type: 'directSale', saleId: ev.saleId },
      })
      soldUnits.push(unit)
    }
    if (taken.length > 0) {
      history.push({
        date: ev.date.toISOString(),
        kind: 'Vendido',
        detail: `${taken.length}x vendida(s) direto · ${formatCurrency(ev.unitPrice)}`,
        link: { type: 'directSale', saleId: ev.saleId },
      })
    }
  }

  // Peças de PRODUÇÃO (não do produto acabado em si) entram só no
  // Histórico, pílula cinza -- "Peças do lote" (parts, abaixo) já soma o
  // total produzido/consumido/sobra; não precisam de unidade própria
  // aqui (não viram "produto acabado" sozinhas, só compõem uma peça).
  if (needsAssembly && product.isComposite) {
    const partRuns = await prisma.productionRun.findMany({
      where: { productId, productPartId: { not: null }, status: { not: 'CANCELADA' } },
      include: { productPart: true, filament: true },
      orderBy: { date: 'asc' },
    })
    for (const r of partRuns) {
      if (r.quantitySuccess <= 0) continue
      history.push({
        date: r.date.toISOString(),
        kind: 'Produzido',
        detail: `${r.quantitySuccess}x ${r.productPart?.name ?? 'peça'} · ${r.filament.colorName}`,
        link: null,
      })
    }
  }

  history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // Monta as linhas finais: unidades que sobraram em cada pool.
  const units: ProductUnit[] = []
  const withPartnersMap = new Map<string, VariantPartnerCount>()
  let inStock = 0
  let returned = 0

  for (const queue of stockQueueByCombo.values()) {
    for (const unit of queue) {
      if (unit.everReturned) returned++
      else inStock++
      units.push({ n: unit.n, comboKey: unit.comboKey, variantLabel: variantLabel(unit.comboKey), colorHexes: variantColorHexes(unit.comboKey), location: unit.location, steps: unit.steps })
    }
  }
  for (const [deliveryId, dq] of deliveryQueue) {
    const delivery = deliveries.find((d) => d.id === deliveryId)
    for (const unit of dq) {
      if (delivery) {
        const entry = withPartnersMap.get(delivery.partnerId) ?? { partnerId: delivery.partnerId, partnerName: delivery.partner.name, quantity: 0 }
        entry.quantity += 1
        withPartnersMap.set(delivery.partnerId, entry)
      }
      units.push({ n: unit.n, comboKey: unit.comboKey, variantLabel: variantLabel(unit.comboKey), colorHexes: variantColorHexes(unit.comboKey), location: unit.location, steps: unit.steps })
    }
  }
  for (const unit of soldUnits) {
    units.push({ n: unit.n, comboKey: unit.comboKey, variantLabel: variantLabel(unit.comboKey), colorHexes: variantColorHexes(unit.comboKey), location: unit.location, steps: unit.steps })
  }
  units.sort((a, b) => a.n - b.n)

  const totalCreated = nextN - 1
  const actualTotal = inStock + returned + [...withPartnersMap.values()].reduce((s, p) => s + p.quantity, 0) + soldUnits.length
  const reconciliationOk = shortfall === 0 && actualTotal === totalCreated
  const reconciliationNote = reconciliationOk
    ? null
    : `Faltam ${totalCreated - actualTotal} unidade(s) pra fechar a conta -- provavelmente um ajuste manual de estoque ou uma entrega/venda com data anterior à montagem. Confira o Histórico.`

  // Tabela compacta de variações (seção 2): "Estoque" aqui soma devolvida
  // + nunca-entregue junto (a tabela não tem coluna "Devolvidas" própria,
  // só os 4 cards do topo distinguem isso).
  const variantRows: VariantTrailRow[] = [...variantInfoByKey.values()].map((v) => {
    const stockUnits = (stockQueueByCombo.get(v.key) ?? []).length
    const partnersForVariant = new Map<string, VariantPartnerCount>()
    let soldForVariant = 0
    for (const unit of units) {
      if (unit.comboKey !== v.key) continue
      if (unit.location.type === 'parceiro') {
        const entry = partnersForVariant.get(unit.location.partnerId) ?? { partnerId: unit.location.partnerId, partnerName: unit.location.partnerName, quantity: 0 }
        entry.quantity += 1
        partnersForVariant.set(unit.location.partnerId, entry)
      } else if (unit.location.type === 'vendida') {
        soldForVariant += 1
      }
    }
    return {
      comboKey: v.key,
      label: v.label,
      colorHexes: variantColorHexes(v.key),
      attrs: v.attrs,
      inStock: stockUnits,
      withPartners: [...partnersForVariant.values()],
      sold: soldForVariant,
      total: stockUnits + [...partnersForVariant.values()].reduce((s, p) => s + p.quantity, 0) + soldForVariant,
    }
  }).sort((a, b) => b.total - a.total)

  let parts: PartLotSummary[] = []
  if (product.isComposite) {
    const status = await getAssemblyStatus(productId)
    parts = status.parts.map((p) => ({ name: p.name, produced: p.produced, consumed: p.consumed, available: p.available }))
  }

  return {
    productId,
    productName: product.name,
    isComposite: product.isComposite,
    needsAssembly,
    totalCreated,
    locationCounts: { inStock, withPartners: [...withPartnersMap.values()], sold: soldUnits.length, returned },
    reconciliationOk,
    reconciliationNote,
    units,
    variantRows,
    parts,
    history,
  }
}

export interface DeliveryDrillDownItem {
  n: number
  variantLabel: string
  colorHexes: string[]
  status: 'vendida' | 'com_parceiro' | 'devolvida'
  soldDetail: { saleReportId: string; unitPrice: number; date: string } | null
}

export interface DeliveryDrillDown {
  deliveryId: string
  partnerId: string
  partnerName: string
  deliveryDate: string
  productId: string
  productName: string
  otherProductsCount: number
  unitPrice: number
  items: DeliveryDrillDownItem[]
  soldCount: number
  remainingCount: number
  valueWithPartner: number
}

export async function getDeliveryDrillDown(deliveryId: string): Promise<DeliveryDrillDown | null> {
  const delivery = await prisma.consignmentDelivery.findUnique({
    where: { id: deliveryId },
    include: { partner: true, product: true, saleReports: { orderBy: { reportDate: 'asc' } } },
  })
  if (!delivery) return null

  const trail = await getProductUnitTrail(delivery.productId)
  const items: DeliveryDrillDownItem[] = trail.units
    .filter((u) => u.steps.some((s) => s.link?.type === 'delivery' && s.link.deliveryId === deliveryId))
    .map((u) => {
      const soldStep = u.steps.find((s) => s.link?.type === 'consignmentSale')
      const status: DeliveryDrillDownItem['status'] = u.location.type === 'vendida' ? 'vendida' : u.location.type === 'devolvida' ? 'devolvida' : 'com_parceiro'
      return {
        n: u.n,
        variantLabel: u.variantLabel,
        colorHexes: u.colorHexes,
        status,
        soldDetail: soldStep && soldStep.link?.type === 'consignmentSale'
          ? { saleReportId: soldStep.link.saleReportId, unitPrice: u.location.type === 'vendida' ? u.location.unitPrice : 0, date: soldStep.date }
          : null,
      }
    })

  const otherProductsCount = await prisma.consignmentDelivery.count({ where: { batchId: delivery.batchId, productId: { not: delivery.productId } } })
  const soldCount = items.filter((i) => i.status === 'vendida').length
  const remainingCount = items.filter((i) => i.status === 'com_parceiro').length

  return {
    deliveryId,
    partnerId: delivery.partnerId,
    partnerName: delivery.partner.name,
    deliveryDate: delivery.deliveryDate.toISOString(),
    productId: delivery.productId,
    productName: delivery.product.name,
    otherProductsCount,
    unitPrice: delivery.unitPrice.toNumber(),
    items,
    soldCount,
    remainingCount,
    valueWithPartner: remainingCount * delivery.unitPrice.toNumber(),
  }
}

export interface ConsignmentSaleDrillDown {
  saleReportId: string
  deliveryId: string
  partnerId: string
  partnerName: string
  productId: string
  productName: string
  variantLabel: string
  reportDate: string
  quantitySold: number
  unitPrice: number
  commissionPercent: number
  commissionValue: number
  unitCost: number
  profit: number
  deliveryDate: string
}

export async function getConsignmentSaleDrillDown(saleReportId: string): Promise<ConsignmentSaleDrillDown | null> {
  const report = await prisma.consignmentSaleReport.findUnique({
    where: { id: saleReportId },
    include: { delivery: { include: { partner: true, product: true } } },
  })
  if (!report) return null
  const unitPrice = (report.unitPrice ?? report.delivery.unitPrice).toNumber()
  const commissionPercent = report.commissionPercent.toNumber()
  const unitCost = await getProductAverageProductionCost(report.delivery.productId)
  const saleValue = report.quantitySold * unitPrice
  const commissionValue = saleValue * commissionPercent
  const costValue = report.quantitySold * unitCost

  // Reaproveita getProductUnitTrail (já resolve rótulo de variante certo
  // pra composto/simples) em vez de duplicar a lógica de needsAssembly +
  // getProductVariantBreakdown aqui.
  let variantLabel = report.delivery.colorComboKey ?? '—'
  if (report.delivery.colorComboKey) {
    const trail = await getProductUnitTrail(report.delivery.productId)
    variantLabel = trail.variantRows.find((v) => v.comboKey === report.delivery.colorComboKey)?.label ?? variantLabel
  }

  return {
    saleReportId,
    deliveryId: report.deliveryId,
    partnerId: report.delivery.partnerId,
    partnerName: report.delivery.partner.name,
    productId: report.delivery.productId,
    productName: report.delivery.product.name,
    variantLabel,
    reportDate: report.reportDate.toISOString(),
    quantitySold: report.quantitySold,
    unitPrice,
    commissionPercent,
    commissionValue,
    unitCost,
    profit: saleValue - commissionValue - costValue,
    deliveryDate: report.delivery.deliveryDate.toISOString(),
  }
}

export interface DirectSaleDrillDown {
  saleId: string
  productId: string
  productName: string
  channel: string
  buyerOrPlatform: string | null
  saleDate: string
  quantity: number
  unitPrice: number
  unitCost: number
  profit: number
}

export async function getDirectSaleDrillDown(saleId: string): Promise<DirectSaleDrillDown | null> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { product: true } })
  if (!sale) return null
  const unitCost = await getProductAverageProductionCost(sale.productId)
  const unitPrice = sale.unitPrice.toNumber()
  return {
    saleId,
    productId: sale.productId,
    productName: sale.product.name,
    channel: sale.channel,
    buyerOrPlatform: sale.buyerOrPlatform,
    saleDate: sale.saleDate.toISOString(),
    quantity: sale.quantity,
    unitPrice,
    unitCost,
    profit: sale.quantity * (unitPrice - unitCost),
  }
}
