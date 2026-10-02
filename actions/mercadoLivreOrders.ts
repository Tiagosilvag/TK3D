'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { reconcileOrderReservations, type OrderReallocationEvent } from '@/lib/orderReservations'
import { resolveNotificationsForResource } from '@/lib/notifications'
import type { MarketplaceOrderInboxItem } from '@/lib/mercadoLivre/orders'

type ActionResult = { success: boolean; error?: string; orderId?: string; reallocations?: OrderReallocationEvent[] }

const ALREADY_PROCESSED_ERROR = 'Este pedido já foi processado'

// Caixa de entrada de pedidos Mercado Livre (Task 10): linhas em
// MarketplaceOrderInbox chegam com status=PENDENTE (webhook/poller, Tasks
// 7-9) e ficam esperando um humano escolher produto+cor pra cada item
// antes de virarem um Order+OrderItem[] de verdade -- ou serem ignoradas.
//
// Finding 5 (revisão final): ler o status e DEPOIS decidir se processa
// (read-then-check) não é atômico -- um duplo-clique ou duas abas
// confirmando/ignorando quase ao mesmo tempo podiam os dois passar pela
// checagem antes de qualquer um gravar, processando o mesmo inbox duas
// vezes. `updateMany` com `status: 'PENDENTE'` no WHERE é a reivindicação
// atômica: só a chamada cuja query realmente bateu uma linha PENDENTE (e
// a mudou) ganha `count === 1` -- a(s) outra(s), não importa a ordem,
// sempre vê(em) `count === 0` (a linha já não está mais PENDENTE).
export async function ignoreInboxOrder(inboxId: string): Promise<ActionResult> {
  const claim = await prisma.marketplaceOrderInbox.updateMany({ where: { id: inboxId, status: 'PENDENTE' }, data: { status: 'IGNORADO' } })
  if (claim.count === 0) return { success: false, error: ALREADY_PROCESSED_ERROR }

  // Finding 2 (revisão final): uma linha de inbox ignorada nunca virou um
  // Order de verdade -- não existe orderId pra passar pelo caminho de
  // resolveMarketplaceNotificationIfTerminal (actions/orders.ts, que lê
  // por confirmedOrderId). Resolve direto pelo recurso que a notificação
  // de "pedido novo" foi criada com (MarketplaceOrderInbox + este id) --
  // senão o sino ficava preso mesmo num pedido do ML que o usuário
  // explicitamente descartou.
  await resolveNotificationsForResource('MarketplaceOrderInbox', inboxId)

  revalidatePath('/orders')
  return { success: true }
}

interface ConfirmItemMapping {
  externalItemId: string
  productId: string
  colorComboKey: string | null
}

class InboxAlreadyProcessedError extends Error {}

// Mesma convenção de createOrder (actions/orders.ts): depois de criar os
// OrderItem, reconcilia cada par (productId, colorComboKey) distinto pra
// que reservedQuantity (nunca escrito à mão -- "estoque derivado, não
// contador redundante") reflita a reserva de verdade, e revalida as
// mesmas 4 rotas que dependem desse estado (/orders, /stock, /production,
// /assembly). Sem isso, um pedido do ML confirmado por aqui nunca teria
// peça reservada, mesmo com estoque disponível.
//
// Finding 4 (revisão final): `deliveryDate` agora vem de quem confirma
// (seletor de data em MarketplaceInboxSection.tsx), nunca mais
// `new Date()` -- reconcileOrderReservations aloca por deliveryDate
// ASCENDENTE (prazo mais próximo primeiro), então todo pedido do ML
// confirmado virava automaticamente "o mais urgente possível", furando a
// fila de pedidos manuais com prazo real e podendo até aparecer como
// atrasado no dia seguinte. `orderDate` passa a vir de
// `inbox.receivedAt` (quando o pedido REALMENTE chegou, via
// webhook/poller) em vez de "quando um humano confirmou" -- mais fiel ao
// histórico. `reallocations` (o que `reconcileOrderReservations` pode ter
// tomado de outro pedido) agora volta pro chamador avisar o usuário, mesmo
// padrão que OrderForm.tsx já usa pra createOrder.
export async function confirmInboxOrder(inboxId: string, mappings: ConfirmItemMapping[], deliveryDate: Date): Promise<ActionResult> {
  const inbox = await prisma.marketplaceOrderInbox.findUniqueOrThrow({ where: { id: inboxId } })

  const items = inbox.items as unknown as MarketplaceOrderInboxItem[]
  if (mappings.length !== items.length) return { success: false, error: 'Faltou escolher o produto de algum item' }
  if (mappings.some((m) => !m.productId)) return { success: false, error: 'Faltou escolher o produto de algum item' }

  let orderId: string
  try {
    orderId = await prisma.$transaction(async (tx) => {
      // Finding 5: primeira operação da transação -- reivindica o inbox
      // atomicamente. Só depois disso (count === 1, garantido que NINGUÉM
      // mais pode reivindicar a mesma linha) é seguro criar o Order.
      const claim = await tx.marketplaceOrderInbox.updateMany({ where: { id: inboxId, status: 'PENDENTE' }, data: { status: 'CONFIRMADO' } })
      if (claim.count === 0) throw new InboxAlreadyProcessedError()

      const created = await tx.order.create({
        data: {
          channel: 'MERCADO_LIVRE',
          orderDate: inbox.receivedAt,
          deliveryDate,
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
      await tx.marketplaceOrderInbox.update({ where: { id: inboxId }, data: { confirmedOrderId: created.id } })
      return created.id
    })
  } catch (err) {
    if (err instanceof InboxAlreadyProcessedError) return { success: false, error: ALREADY_PROCESSED_ERROR }
    throw err
  }

  const distinctPairs = new Map<string, { productId: string; colorComboKey: string | null }>()
  for (const m of mappings) distinctPairs.set(`${m.productId}::${m.colorComboKey ?? ''}`, m)
  const reallocations: OrderReallocationEvent[] = []
  for (const { productId, colorComboKey } of distinctPairs.values()) {
    reallocations.push(...(await reconcileOrderReservations(productId, colorComboKey)))
  }

  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, orderId, reallocations }
}
