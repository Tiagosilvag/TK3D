'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deliverOrderItem, undoOrderItemDelivery } from '@/actions/orders'
import { UndoToast } from '@/components/UndoToast'
import { formatCurrency } from '@/lib/format'

export interface ReadyOrderRow {
  id: string
  productName: string
  quantity: number
  unitPrice: number
  buyer: string | null
  channelLabel: string
  deliveryLabel: string
  variation: string | null
}

// Pedidos prontos (variação reservada em estoque): "✓ Entregar" registra a
// venda com o preço, o comprador e a variação do pedido, a embalagem do
// produto e a taxa do canal -- 1 clique, com o lucro no aviso e Desfazer por
// 10 s (devolve o pedido à lista, a embalagem ao estoque e apaga a venda).
export function PendingDeliveriesPanel({ rows }: { rows: ReadyOrderRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; itemId: string } | null>(null)

  async function deliver(row: ReadyOrderRow) {
    if (busyId) return
    setBusyId(row.id)
    setError(null)
    const result = await deliverOrderItem(row.id)
    setBusyId(null)
    if (!result.success) return setError(result.error ?? 'Não foi possível entregar.')
    const profit = result.profit !== undefined ? ` Lucro ${formatCurrency(result.profit)}.` : ''
    setToast({ message: `Venda registrada: ${row.productName}.${profit}`, itemId: row.id })
    router.refresh()
  }

  async function undo() {
    const t = toast
    setToast(null)
    if (!t) return
    const result = await undoOrderItemDelivery(t.itemId)
    if (!result.success) setError(result.error ?? 'Não foi possível desfazer.')
    router.refresh()
  }

  if (rows.length === 0) {
    return toast ? <UndoToast message={toast.message} onUndo={undo} onDismiss={() => setToast(null)} durationMs={10000} /> : null
  }

  return (
    <div className="tk-panel mb-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Pedidos prontos para entregar</h2>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{rows.length}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">✓ Entregar registra a venda com o preço e o comprador do pedido, a variação reservada e a embalagem do produto.</p>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {r.productName}
                <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                  × {r.quantity} · {formatCurrency(r.unitPrice)}{r.buyer ? ` · ${r.buyer}` : ''} · {r.channelLabel} · entrega {r.deliveryLabel}
                </span>
              </p>
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Reservado em estoque{r.variation ? ` · ${r.variation}` : ''}
              </p>
            </div>
            <button type="button" disabled={busyId !== null} onClick={() => void deliver(r)} className="tk-btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
              ✓ Entregar
            </button>
          </li>
        ))}
      </ul>
      {toast && <UndoToast message={toast.message} onUndo={undo} onDismiss={() => setToast(null)} durationMs={10000} />}
    </div>
  )
}
