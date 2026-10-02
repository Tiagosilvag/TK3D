'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { reconcileOrderReservations } from '@/lib/orderReservations'
import type { MarketplaceOrderInboxItem } from '@/lib/mercadoLivre/orders'

type ActionResult = { success: boolean; error?: string; orderId?: string }

// Caixa de entrada de pedidos Mercado Livre (Task 10): linhas em
// MarketplaceOrderInbox chegam com status=PENDENTE (webhook/poller, Tasks
// 7-9) e ficam esperando um humano escolher produto+cor pra cada item
// antes de virarem um Order+OrderItem[] de verdade -- ou serem ignoradas.
export async function ignoreInboxOrder(inboxId: string): Promise<ActionResult> {
  await prisma.marketplaceOrderInbox.update({ where: { id: inboxId }, data: { status: 'IGNORADO' } })
  revalidatePath('/orders')
  return { success: true }
}

interface ConfirmItemMapping {
  externalItemId: string
  productId: string
  colorComboKey: string | null
}

// Mesma convenção de createOrder (actions/orders.ts): depois de criar os
// OrderItem, reconcilia cada par (productId, colorComboKey) distinto pra
// que reservedQuantity (nunca escrito à mão -- "estoque derivado, não
// contador redundante") reflita a reserva de verdade, e revalida as
// mesmas 4 rotas que dependem desse estado (/orders, /stock, /production,
// /assembly). Sem isso, um pedido do ML confirmado por aqui nunca teria
// peça reservada, mesmo com estoque disponível.
export async function confirmInboxOrder(inboxId: string, mappings: ConfirmItemMapping[]): Promise<ActionResult> {
  const inbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inboxId } })
  if (inbox.status !== 'PENDENTE') return { success: false, error: 'Este pedido já foi processado' }

  const items = inbox.items as unknown as MarketplaceOrderInboxItem[]
  if (mappings.length !== items.length) return { success: false, error: 'Faltou escolher o produto de algum item' }
  if (mappings.some((m) => !m.productId)) return { success: false, error: 'Faltou escolher o produto de algum item' }

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        channel: 'MERCADO_LIVRE',
        orderDate: new Date(),
        deliveryDate: new Date(),
        buyerOrPlatform: inbox.buyerName,
        orderNumber: inbox.externalOrderId,
        items: {
          create: items.map((item, index) => ({
            productId: mappings[index].productId,
            colorComboKey: mappings[index].colorComboKey,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
    })
    await tx.marketplaceOrderInbox.update({ where: { id: inboxId }, data: { status: 'CONFIRMADO', confirmedOrderId: created.id } })
    return created
  })

  const distinctPairs = new Map<string, { productId: string; colorComboKey: string | null }>()
  for (const m of mappings) distinctPairs.set(`${m.productId}::${m.colorComboKey ?? ''}`, m)
  for (const { productId, colorComboKey } of distinctPairs.values()) {
    await reconcileOrderReservations(productId, colorComboKey)
  }

  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, orderId: order.id }
}
