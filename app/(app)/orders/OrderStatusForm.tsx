'use client'
import { useRouter } from 'next/navigation'
import { updateOrderItemStatus } from '@/actions/orders'
import type { OrderStatus } from '@prisma/client'

// Melhoria "Pedidos com reserva de estoque" + "Pedidos com múltiplos
// itens": os status intermediários (AGUARDANDO_PRODUCAO/PARCIAL_.../
// AGUARDANDO_MONTAGEM/PRONTO_RESERVADO) são DERIVADOS -- escritos só por
// reconcileOrderReservations, nunca editáveis à mão. O select virou só
// este botão "Marcar como entregue" (única transição manual que sobrou --
// é o que cria a Sale), agora por ITEM (cada um tem seu próprio ciclo de
// vida). Cancelar é uma ação separada, no nível do PEDIDO (cancelOrder em
// OrdersExplorer.tsx), não faz parte deste componente.
export function OrderStatusForm({ orderItemId, status }: { orderItemId: string; status: OrderStatus }) {
  const router = useRouter()
  const isTerminal = status === 'ENTREGUE' || status === 'CANCELADO'
  if (isTerminal) return null

  async function markDelivered() {
    const formData = new FormData()
    formData.set('status', 'ENTREGUE')
    const result = await updateOrderItemStatus(orderItemId, formData)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  return (
    <button type="button" onClick={() => void markDelivered()} className="tk-link-success text-xs">
      Marcar entregue
    </button>
  )
}
