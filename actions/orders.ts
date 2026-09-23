'use server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { orderSchema, orderStatusEnum } from '@/lib/validation/order'
import { getProductCostBreakdown } from '@/actions/products'
import { consumePackagingForSale } from '@/actions/sales'
import { resolveSalePlatformFee } from '@/actions/marketplacePlatforms'
import { buildSaleCostSnapshot } from '@/lib/costing'
import { productNeedsAssembly } from '@/lib/products'
import { getAssemblyStatus } from '@/actions/assembly'
import { reconcileOrderReservations, type OrderReallocationEvent } from '@/lib/orderReservations'
import { revalidatePath } from 'next/cache'
import type { Prisma, OrderChannel, OrderStatus, SaleChannel } from '@prisma/client'

type ActionResult = { success: boolean; error?: string; reallocations?: OrderReallocationEvent[] }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return orderSchema.safeParse({
    ...raw,
    colorComboKey: raw.colorComboKey || null,
    buyerOrPlatform: raw.buyerOrPlatform || null,
    orderNumber: raw.orderNumber || null,
    notes: raw.notes || null,
  })
}

// Melhoria "Pedidos com reserva de estoque": depois de criar o pedido,
// tenta reservar do estoque disponível na hora (reconcileOrderReservations
// recalcula a fila inteira daquele produto+variação, do zero, por
// prioridade de prazo) -- se isso tomar peça de outro pedido que já
// tinha reserva (só acontece quando o pedido novo é mais urgente que um
// já reservado), os eventos voltam no ActionResult pro form mostrar o
// aviso passageiro (só existe aqui -- produção/montagem nunca "roubam"
// reserva de ninguém, só preenchem buraco, ver lib/orderReservations.ts).
export async function createOrder(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const order = await prisma.order.create({ data: parsed.data })
  const reallocations = await reconcileOrderReservations(order.productId, order.colorComboKey)
  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Direta -> venda Direta; Shopee/Mercado Livre -> venda Marketplace (o
// enum de Sale só distingue esses dois grandes grupos) -- o nome exato da
// plataforma vai pro campo Comprador/Plataforma da Sale, então a
// informação não se perde mesmo sem 4.1 (plataformas configuráveis) ainda
// existir.
const ORDER_CHANNEL_TO_SALE_CHANNEL: Record<OrderChannel, SaleChannel> = {
  DIRETA: 'DIRETA',
  SHOPEE: 'MARKETPLACE',
  MERCADO_LIVRE: 'MARKETPLACE',
}
const ORDER_CHANNEL_PLATFORM_LABEL: Record<OrderChannel, string> = {
  DIRETA: 'Direta',
  SHOPEE: 'Shopee',
  MERCADO_LIVRE: 'Mercado Livre',
}

const updateStatusSchema = z.object({ status: orderStatusEnum })

// Muda o status do pedido; ao chegar em ENTREGUE pela primeira vez (nunca
// se já tiver saleId -- idempotente contra clique duplo/reentrada), cria a
// Sale correspondente com o costSnapshot já congelado (mesmo padrão de
// createSale em actions/sales.ts) e vincula via Order.saleId. "Dar baixa
// no estoque" continua sendo só essa Sale entrando na conta de
// getOwnStockSummary -- sem contador separado. Melhoria "Pedidos com
// reserva de estoque": ENTREGUE assumiu o papel que CONCLUIDO tinha (esse
// último vira legado, nunca mais escrito); os status intermediários
// (AGUARDANDO_PRODUCAO/PARCIAL_.../AGUARDANDO_MONTAGEM/PRONTO_RESERVADO)
// não são mais setados por aqui -- são derivados por
// reconcileOrderReservations, a UI só mostra (ver OrderStatusForm.tsx).
export async function updateOrderStatus(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = updateStatusSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const order = await prisma.order.findUniqueOrThrow({ where: { id } })

  if (parsed.data.status !== 'ENTREGUE' || order.saleId) {
    await prisma.order.update({ where: { id }, data: { status: parsed.data.status } })
    revalidatePath('/orders')
    return { success: true }
  }

  const breakdown = await getProductCostBreakdown(order.productId)
  const saleChannel = ORDER_CHANNEL_TO_SALE_CHANNEL[order.channel]
  const platformFee = await resolveSalePlatformFee(saleChannel, order.unitPrice.toNumber(), order.productId)
  const snapshot = buildSaleCostSnapshot(
    breakdown,
    order.quantity,
    platformFee ? { feePercent: platformFee.feePercent, feeFixed: platformFee.feeFixed, amountTotal: platformFee.feeAmountPerUnit * order.quantity } : undefined,
  )

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        channel: saleChannel,
        productId: order.productId,
        colorComboKey: order.colorComboKey,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        saleDate: new Date(),
        buyerOrPlatform: order.buyerOrPlatform ?? ORDER_CHANNEL_PLATFORM_LABEL[order.channel],
        notes: order.orderNumber ? `Pedido #${order.orderNumber}` : null,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        // Melhoria "Vendas: múltiplos produtos numa venda": Sale.batchId é
        // NOT NULL -- pedido concluído sempre vira uma venda de 1 item só,
        // então recebe seu próprio lote (mesmo raciocínio de createSale).
        batchId: randomUUID(),
      },
    })
    await tx.order.update({ where: { id }, data: { status: 'ENTREGUE', saleId: sale.id } })
    // Melhoria "Histórico de consumo": mesmo consumo de embalagem que
    // createSale aplica (actions/sales.ts) -- pedido concluído vira Sale
    // aqui direto (nunca chama createSale), então precisa do mesmo passo.
    await consumePackagingForSale(tx, sale.id, order.productId, order.quantity)
  })

  // ENTREGUE é terminal -- sai da conta de "reservado", reconcilia pra
  // dar a próxima peça (se sobrar alguma, o que não deveria acontecer já
  // que este pedido só chega aqui com reservedQuantity == quantity, mas
  // roda mesmo assim por segurança/consistência).
  await reconcileOrderReservations(order.productId, order.colorComboKey)

  revalidatePath('/orders')
  revalidatePath('/sales')
  revalidatePath('/stock')
  revalidatePath('/packaging')
  return { success: true }
}

// Melhoria "Pedidos com reserva de estoque": cancelar é diferente de
// excluir -- o pedido continua existindo (histórico), só vira terminal
// (CANCELADO) e sai da conta de "reservado"/fila de demanda.
// reservedQuantity NÃO é zerado (fica como registro do que este pedido
// chegou a ter, mesma filosofia de nunca reescrever fato passado --
// costSnapshot é o precedente) -- quem muda é a exclusão de CANCELADO da
// soma de "reservado" em lib/reports.ts, então a peça já volta a contar
// como Disponível sem precisar apagar nada; reconcileOrderReservations
// roda em seguida pra dar a peça liberada pro próximo pedido da fila.
export async function cancelOrder(id: string): Promise<ActionResult> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id } })
  if (order.saleId) {
    return { success: false, error: 'Este pedido já foi entregue e virou uma venda — cancele a venda em Vendas, se necessário.' }
  }
  await prisma.order.update({ where: { id }, data: { status: 'CANCELADO' } })
  const reallocations = await reconcileOrderReservations(order.productId, order.colorComboKey)
  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Só pedidos ainda não entregues podem ser removidos -- uma vez com Sale
// vinculada, a Sale é o registro real da transação (deleteSale, se for o
// caso, já existe em actions/sales.ts).
export async function deleteOrder(id: string): Promise<ActionResult> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id } })
  if (order.saleId) {
    return { success: false, error: 'Este pedido já foi entregue e virou uma venda — remova a venda em Vendas, se necessário.' }
  }
  await prisma.order.delete({ where: { id } })
  await reconcileOrderReservations(order.productId, order.colorComboKey)
  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true }
}

// Melhoria "Fila de demanda em Produção/Montagem": 1 linha por (pedido,
// peça-ou-produto) que ainda falta pra fechar aquele pedido -- só pedido
// não-terminal com quantity > reservedQuantity entra aqui. Produto sem
// componente nenhum (não precisa de montagem) só pode faltar "produzir o
// produto direto" -- entra em productionRows. Produto que precisa de
// montagem quebra o que falta em, por peça: quanto dá pra cobrir com peça
// JÁ produzida esperando montagem (assemblyRows) e quanto ainda falta
// produzir de cada peça (productionRows) -- reivindicando de um "pool"
// corrido por peça (inicializado do que getAssemblyStatus reporta como
// disponível agora), na mesma ordem de prioridade por prazo que
// reconcileOrderReservations usa pra reserva de verdade, pra não
// superestimar quando 2+ pedidos disputam a mesma peça na exibição.
export interface OrderDemandRow {
  orderId: string
  orderNumber: string | null
  channel: OrderChannel
  buyerOrPlatform: string | null
  deliveryDate: Date
  status: OrderStatus
  productId: string
  productName: string
  partId: string | null
  partName: string | null
  neededUnits: number
  reservedQuantity: number
  quantity: number
}

export async function getOrderDemandQueue(): Promise<{ productionRows: OrderDemandRow[]; assemblyRows: OrderDemandRow[] }> {
  const orders = await prisma.order.findMany({
    where: { status: { notIn: ['ENTREGUE', 'CANCELADO'] } },
    include: { product: { include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } } } },
    orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
  })
  const pending = orders.filter((o) => o.quantity > o.reservedQuantity)
  if (pending.length === 0) return { productionRows: [], assemblyRows: [] }

  const productionRows: OrderDemandRow[] = []
  const assemblyRows: OrderDemandRow[] = []
  const cacheByProduct = new Map<string, { parts: Awaited<ReturnType<typeof getAssemblyStatus>>['parts']; pool: Map<string, number> }>()

  for (const order of pending) {
    const shortfall = order.quantity - order.reservedQuantity
    const product = order.product
    const base = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: order.channel,
      buyerOrPlatform: order.buyerOrPlatform,
      deliveryDate: order.deliveryDate,
      status: order.status,
      productId: product.id,
      productName: product.name,
      reservedQuantity: order.reservedQuantity,
      quantity: order.quantity,
    }

    const needsAssembly = productNeedsAssembly({
      isComposite: product.isComposite,
      accessoryUsagesCount: product._count.accessoryUsages,
      supplyUsagesCount: product._count.supplyUsages,
      componentUsagesCount: product._count.componentUsages,
    })

    if (!needsAssembly) {
      productionRows.push({ ...base, partId: null, partName: null, neededUnits: shortfall })
      continue
    }

    if (!cacheByProduct.has(product.id)) {
      const status = await getAssemblyStatus(product.id)
      const pool = new Map<string, number>()
      for (const part of status.parts) pool.set(part.partId, part.available)
      cacheByProduct.set(product.id, { parts: status.parts, pool })
    }
    const { parts, pool } = cacheByProduct.get(product.id)!

    let assemblableUnits = shortfall
    for (const part of parts) {
      const poolAvail = pool.get(part.partId) ?? 0
      const unitsFromThisPart = part.quantityPerUnit > 0 ? Math.floor(poolAvail / part.quantityPerUnit) : shortfall
      assemblableUnits = Math.min(assemblableUnits, unitsFromThisPart)
    }
    assemblableUnits = Math.max(0, assemblableUnits)

    if (assemblableUnits > 0) {
      assemblyRows.push({ ...base, partId: null, partName: null, neededUnits: assemblableUnits })
      for (const part of parts) {
        pool.set(part.partId, (pool.get(part.partId) ?? 0) - assemblableUnits * part.quantityPerUnit)
      }
    }

    const remaining = shortfall - assemblableUnits
    if (remaining > 0) {
      for (const part of parts) {
        const neededForPart = remaining * part.quantityPerUnit
        const poolAvail = Math.max(0, pool.get(part.partId) ?? 0)
        const stillMissing = Math.max(0, neededForPart - poolAvail)
        pool.set(part.partId, poolAvail - Math.min(poolAvail, neededForPart))
        if (stillMissing > 0) {
          productionRows.push({ ...base, partId: part.partId, partName: part.name, neededUnits: stillMissing })
        }
      }
    }
  }

  return { productionRows, assemblyRows }
}
