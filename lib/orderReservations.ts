import { prisma } from '@/lib/prisma'
import { productNeedsAssembly } from '@/lib/products'
import { getProductVariantBreakdown, deserializeColorChoices } from '@/lib/reports'
import { getAssemblyStatus, type AssemblyStatus } from '@/actions/assembly'
import type { OrderStatus } from '@prisma/client'

// Melhoria "Pedidos com reserva de estoque": motor central que decide
// quanto de cada pedido está garantido do estoque físico agora
// (Order.reservedQuantity) e qual status cada um tem -- SEMPRE
// recalculando do zero pra um (productId, colorComboKey), nunca
// incrementando/decrementando um contador isolado. Mesma filosofia
// "estoque derivado, não contador redundante" do resto do app (CLAUDE.md),
// aplicada aqui a uma ALOCAÇÃO POR PRIORIDADE (prazo de entrega mais
// próximo primeiro) em vez de uma soma simples.
//
// Só pedido NOVO ou EDITADO pode "tomar" peça de um pedido que já tinha
// reserva -- produção e montagem só ADICIONAM estoque, o que nunca piora
// a posição de quem já tava reservado (só preenche buraco de quem tava
// esperando). Por isso só createOrder/cancelOrder/deleteOrder retornam
// os eventos de realocação pro chamador mostrar um aviso passageiro; as
// telas de Produção/Montagem só mostram a etiqueta PERMANENTE (lida de
// OrderReallocation depois, não retornada por elas).
//
// Roda sua PRÓPRIA transação (não recebe `tx` de fora) -- app de usuário
// único (senha compartilhada, sem multiusuário, CLAUDE.md), então a
// janela entre a ação que mudou o estoque e esta reconciliação rodar
// logo em seguida não é um risco real de concorrência; em troca, evita
// ter que fazer getProductVariantBreakdown/getAssemblyStatus aceitarem
// um client de transação (refatoração grande e sem necessidade real
// aqui).

const TERMINAL_STATUSES: OrderStatus[] = ['ENTREGUE', 'CANCELADO']

export interface OrderReallocationEvent {
  productId: string
  colorComboKey: string | null
  quantity: number
  fromOrderId: string
  fromOrderNumber: string | null
  toOrderId: string
  toOrderNumber: string | null
}

// Quanto do PRODUTO INTEIRO (sem distinguir variante -- pedido sem
// colorComboKey, produto sem variante conhecida) está fisicamente
// reivindicável agora, ANTES de qualquer reserva de pedido -- mesma
// fórmula que getOwnStockSummary usa pra "Disponível"
// (produzido − vendido − entregue + ajuste − consumido-como-componente,
// lib/reports.ts), só que rodada pra 1 produto só em vez de em lote.
async function getConsumedAsComponent(productId: string): Promise<number> {
  const usages = await prisma.productComponentUsage.findMany({ where: { componentProductId: productId } })
  if (usages.length === 0) return 0
  const qtyPerUnitByParent = new Map(usages.map((u) => [u.productId, u.quantity]))
  const assemblies = await prisma.productAssembly.findMany({
    where: { productId: { in: [...qtyPerUnitByParent.keys()] } },
    select: { productId: true, quantity: true, colorChoices: true },
  })
  let total = 0
  for (const a of assemblies) {
    const choices = a.colorChoices as Record<string, string> | null
    if (!choices || !(productId in choices)) continue
    total += a.quantity * (qtyPerUnitByParent.get(a.productId) ?? 0)
  }
  return total
}

async function getRawProductAvailable(productId: string, needsAssembly: boolean): Promise<number> {
  const [producedAgg, assembledAgg, soldAgg, deliveries, adjustmentAgg, consumedAsComponent] = await Promise.all([
    prisma.productionRun.aggregate({ where: { productId, productPartId: null, status: { not: 'CANCELADA' } }, _sum: { quantitySuccess: true } }),
    prisma.productAssembly.aggregate({ where: { productId }, _sum: { quantity: true } }),
    prisma.sale.aggregate({ where: { productId }, _sum: { quantity: true } }),
    prisma.consignmentDelivery.findMany({ where: { productId } }),
    prisma.stockAdjustment.aggregate({ where: { resourceType: 'PRODUCT', resourceId: productId }, _sum: { difference: true } }),
    getConsumedAsComponent(productId),
  ])
  const produced = needsAssembly ? (assembledAgg._sum.quantity ?? 0) : (producedAgg._sum.quantitySuccess ?? 0)
  const soldDirect = soldAgg._sum.quantity ?? 0
  const delivered = deliveries.reduce((sum, d) => sum + d.quantityDelivered, 0)
  const adjustment = adjustmentAgg._sum.difference?.toNumber() ?? 0
  return Math.max(0, produced - soldDirect - delivered + adjustment - consumedAsComponent)
}

// Mesma fórmula que getProductVariantStockOptions usa por variante
// (produzido_da_variante − entregue_da_variante − vendido_da_variante,
// lib/reports.ts) -- não soma ajuste/consumido-como-componente porque
// nenhum dos dois é rastreado por variante hoje em lugar nenhum do app
// (mesma limitação aceita que a tela de Vendas já convive).
async function getRawVariantAvailable(productId: string, colorComboKey: string, needsAssembly: boolean): Promise<number> {
  const breakdown = await getProductVariantBreakdown(productId, needsAssembly)
  const variant = breakdown.find((v) => v.key === colorComboKey)
  const produced = variant?.quantity ?? 0
  const [deliveredAgg, soldAgg] = await Promise.all([
    prisma.consignmentDelivery.aggregate({ where: { productId, colorComboKey }, _sum: { quantityDelivered: true } }),
    prisma.sale.aggregate({ where: { productId, colorComboKey }, _sum: { quantity: true } }),
  ])
  return Math.max(0, produced - (deliveredAgg._sum.quantityDelivered ?? 0) - (soldAgg._sum.quantity ?? 0))
}

// Encomenda com variação personalizada: quanto dá pra montar AGORA pra um
// (productId, colorComboKey) ESPECÍFICO -- ao contrário de
// AssemblyStatus.maxAssemblableUnits (produto inteiro, qualquer cor),
// aqui cada peça de cor variável só conta a fatia do combo que o PEDIDO
// pediu (via colorOptions, já calculado por getAssemblyStatus), nunca a
// soma de todas as cores dessa peça. Peça de receita fixa (colorOptions
// null) não é escolha do pedido -- usa maxUnitsFromThisPart normal.
// colorComboKey null (produto sem variante rastreada, ou pedido genérico
// de peça única) cai no sinal antigo, sem quebrar o comportamento de
// sempre.
export function maxAssemblableUnitsForCombo(status: AssemblyStatus, colorComboKey: string | null): number {
  if (colorComboKey === null) return status.maxAssemblableUnits
  if (status.parts.length === 0) return 0
  const choices = deserializeColorChoices(colorComboKey)
  const limits = status.parts.map((part) => {
    if (!part.colorOptions) return part.maxUnitsFromThisPart
    const chosenKey = choices[part.partId]
    const option = part.colorOptions.find((o) => o.key === chosenKey)
    const available = option?.available ?? 0
    return part.quantityPerUnit > 0 ? Math.floor(available / part.quantityPerUnit) : 0
  })
  return Math.max(0, Math.min(...limits))
}

function computeOrderStatus(
  quantity: number,
  reserved: number,
  needsAssembly: boolean,
  maxAssemblableUnits: number,
): OrderStatus {
  if (reserved >= quantity) return 'PRONTO_RESERVADO'
  if (reserved > 0) return 'PARCIAL_AGUARDANDO_PRODUCAO'
  if (needsAssembly && maxAssemblableUnits > 0) return 'AGUARDANDO_MONTAGEM'
  return 'AGUARDANDO_PRODUCAO'
}

export async function reconcileOrderReservations(
  productId: string,
  colorComboKey: string | null,
): Promise<OrderReallocationEvent[]> {
  const [product, orders] = await Promise.all([
    prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
    }),
    prisma.order.findMany({
      where: { productId, colorComboKey, status: { notIn: TERMINAL_STATUSES } },
      orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
    }),
  ])
  if (orders.length === 0) return []

  const needsAssembly = productNeedsAssembly({
    isComposite: product.isComposite,
    accessoryUsagesCount: product._count.accessoryUsages,
    supplyUsagesCount: product._count.supplyUsages,
    componentUsagesCount: product._count.componentUsages,
  })

  const [claimable, assemblyStatus] = await Promise.all([
    colorComboKey === null
      ? getRawProductAvailable(productId, needsAssembly)
      : getRawVariantAvailable(productId, colorComboKey, needsAssembly),
    needsAssembly ? getAssemblyStatus(productId) : Promise.resolve(null),
  ])
  const maxAssemblableUnits = assemblyStatus ? maxAssemblableUnitsForCombo(assemblyStatus, colorComboKey) : 0

  let remaining = claimable
  const results = orders.map((o) => {
    const assign = Math.min(remaining, o.quantity)
    remaining -= assign
    return { order: o, newReserved: assign, newStatus: computeOrderStatus(o.quantity, assign, needsAssembly, maxAssemblableUnits) }
  })

  const changed = results.filter((r) => r.newReserved !== r.order.reservedQuantity || r.newStatus !== r.order.status)
  if (changed.length === 0) return []

  // Diffa reservedQuantity antigo vs novo pra achar quem perdeu ("loser",
  // delta negativo) e quem ganhou ("winner", delta positivo) -- só
  // acontece quando a composição da fila mudou (pedido novo/editado
  // entrando com prioridade maior), nunca só por mais estoque aparecer
  // (mais estoque só preenche buraco de quem tava esperando, nunca tira
  // de quem já tinha). Faz um "netting" genérico entre as duas listas --
  // não importa qual perdedor específico corresponde a qual ganhador
  // específico, só que a quantidade bata.
  const losers: { id: string; orderNumber: string | null; qty: number }[] = []
  const winners: { id: string; orderNumber: string | null; qty: number }[] = []
  for (const r of results) {
    const delta = r.newReserved - r.order.reservedQuantity
    if (delta < 0) losers.push({ id: r.order.id, orderNumber: r.order.orderNumber, qty: -delta })
    else if (delta > 0) winners.push({ id: r.order.id, orderNumber: r.order.orderNumber, qty: delta })
  }
  const events: OrderReallocationEvent[] = []
  let li = 0
  let wi = 0
  while (li < losers.length && wi < winners.length) {
    const take = Math.min(losers[li].qty, winners[wi].qty)
    events.push({
      productId,
      colorComboKey,
      quantity: take,
      fromOrderId: losers[li].id,
      fromOrderNumber: losers[li].orderNumber,
      toOrderId: winners[wi].id,
      toOrderNumber: winners[wi].orderNumber,
    })
    losers[li].qty -= take
    winners[wi].qty -= take
    if (losers[li].qty === 0) li++
    if (winners[wi].qty === 0) wi++
  }

  await prisma.$transaction([
    ...changed.map((r) =>
      prisma.order.update({ where: { id: r.order.id }, data: { reservedQuantity: r.newReserved, status: r.newStatus } }),
    ),
    ...events.map((e) =>
      prisma.orderReallocation.create({
        data: {
          productId: e.productId,
          colorComboKey: e.colorComboKey,
          quantity: e.quantity,
          fromOrderId: e.fromOrderId,
          toOrderId: e.toOrderId,
        },
      }),
    ),
  ])

  return events
}

// Bug "pedido antigo fica travado mostrando falta produzir pra sempre":
// reconcileOrderReservations só roda quando ALGO dispara ela (criar
// produção, montar, criar/cancelar/excluir pedido) -- um pedido cuja
// reconciliação deveria ter rodado num evento passado (ex.: criado antes
// de um fix de escopo de reconciliação, como o de confirmAssembly/
// maybeReconcileAfterProduction) fica com reservedQuantity desatualizado
// pra sempre, até por acaso outro evento do MESMO produto+combo disparar
// de novo -- nada re-sincroniza pedidos "esquecidos" sozinho. Botão
// manual "Recalcular pedidos" (DemandQueuePanel) chama isto pra varrer
// TODO (productId, colorComboKey) com pedido pendente e reconciliar cada
// um -- barato/idempotente quando nada mudou, mesma garantia de
// reconcileOrderReservations.
export async function reconcileAllPendingOrders(): Promise<void> {
  const pending = await prisma.order.findMany({
    where: { status: { notIn: TERMINAL_STATUSES } },
    select: { productId: true, colorComboKey: true },
    distinct: ['productId', 'colorComboKey'],
  })
  for (const { productId, colorComboKey } of pending) {
    await reconcileOrderReservations(productId, colorComboKey)
  }
}
