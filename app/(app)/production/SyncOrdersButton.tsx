'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { syncOrderReservations } from '@/actions/orders'

// Bug "pedido antigo fica travado mostrando falta produzir pra sempre":
// botão manual -- roda reconcileAllPendingOrders (lib/orderReservations.ts)
// pra re-sincronizar TODO pedido pendente contra o estoque/produção atual
// de uma vez, em vez de depender de outro evento (criar produção, montar,
// criar/cancelar pedido) disparar a reconciliação daquele produto+combo
// especificamente por acaso.
export function SyncOrdersButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function sync() {
    startTransition(async () => {
      await syncOrderReservations()
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={sync}
      disabled={isPending}
      className="shrink-0 text-xs font-medium text-violet-600 hover:underline disabled:opacity-60 dark:text-violet-400"
    >
      {isPending ? 'Recalculando…' : 'Recalcular pedidos'}
    </button>
  )
}
