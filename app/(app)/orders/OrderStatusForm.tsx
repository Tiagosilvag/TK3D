'use client'
import { useRouter } from 'next/navigation'
import { updateOrderStatus } from '@/actions/orders'
import type { OrderStatus } from '@prisma/client'

// Melhoria "Pedidos com reserva de estoque": os status intermediários
// (AGUARDANDO_PRODUCAO/PARCIAL_.../AGUARDANDO_MONTAGEM/PRONTO_RESERVADO)
// viraram DERIVADOS -- escritos só por reconcileOrderReservations, nunca
// editáveis à mão. O select virou só este botão "Marcar como entregue"
// (única transição manual que sobrou -- é o que cria a Sale). Cancelar é
// uma ação separada (ver ConfirmDeleteForm com cancelOrder em page.tsx),
// não faz parte deste componente.
export function OrderStatusForm({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter()
  const isTerminal = status === 'ENTREGUE' || status === 'CANCELADO'
  if (isTerminal) return null

  async function markDelivered() {
    const formData = new FormData()
    formData.set('status', 'ENTREGUE')
    const result = await updateOrderStatus(orderId, formData)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  return (
    <button type="button" onClick={() => void markDelivered()} className="tk-link-success text-xs">
      Marcar entregue
    </button>
  )
}
