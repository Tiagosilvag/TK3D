'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { orderSchema, orderStatusEnum } from '@/lib/validation/order'
import { getProductCostBreakdown } from '@/actions/products'
import { buildSaleCostSnapshot } from '@/lib/costing'
import { revalidatePath } from 'next/cache'
import type { Prisma, OrderChannel, SaleChannel } from '@prisma/client'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return orderSchema.safeParse({
    ...raw,
    orderNumber: raw.orderNumber || null,
    notes: raw.notes || null,
  })
}

export async function createOrder(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.order.create({ data: parsed.data })
  revalidatePath('/orders')
  return { success: true }
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

// Muda o status do pedido; ao chegar em CONCLUIDO pela primeira vez (nunca
// se já tiver saleId -- idempotente contra clique duplo/reentrada), cria a
// Sale correspondente com o costSnapshot já congelado (mesmo padrão de
// createSale em actions/sales.ts) e vincula via Order.saleId. "Dar baixa
// no estoque" (spec 2.4) é só essa Sale entrando na conta de
// getOwnStockSummary (2.2) -- sem contador separado pra manter em dia.
export async function updateOrderStatus(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = updateStatusSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const order = await prisma.order.findUniqueOrThrow({ where: { id } })

  if (parsed.data.status !== 'CONCLUIDO' || order.saleId) {
    await prisma.order.update({ where: { id }, data: { status: parsed.data.status } })
    revalidatePath('/orders')
    return { success: true }
  }

  const breakdown = await getProductCostBreakdown(order.productId)
  const snapshot = buildSaleCostSnapshot(breakdown, order.quantity)

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        channel: ORDER_CHANNEL_TO_SALE_CHANNEL[order.channel],
        productId: order.productId,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        saleDate: new Date(),
        buyerOrPlatform: ORDER_CHANNEL_PLATFORM_LABEL[order.channel],
        notes: order.orderNumber ? `Pedido #${order.orderNumber}` : null,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    })
    await tx.order.update({ where: { id }, data: { status: 'CONCLUIDO', saleId: sale.id } })
  })

  revalidatePath('/orders')
  revalidatePath('/sales')
  revalidatePath('/stock')
  return { success: true }
}

// Só pedidos ainda não concluídos podem ser removidos -- uma vez com Sale
// vinculada, a Sale é o registro real da transação (deleteSale, se for o
// caso, já existe em actions/sales.ts).
export async function deleteOrder(id: string): Promise<ActionResult> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id } })
  if (order.saleId) {
    return { success: false, error: 'Este pedido já foi concluído e virou uma venda — remova a venda em Vendas, se necessário.' }
  }
  await prisma.order.delete({ where: { id } })
  revalidatePath('/orders')
  return { success: true }
}
