import Link from 'next/link'
import { getDeadlineBadge, ORDER_CHANNEL_LABELS } from '@/lib/format'
import type { OrderDemandRow } from '@/actions/orders'

// Melhoria "Pedidos com reserva de estoque" §3: painel "Peças pendentes
// de encomenda" no topo de Produção -- só peça que ainda NÃO existe
// fisicamente (nem impressa nem montada) e que algum pedido precisa.
// Ordenado por prazo mais próximo primeiro (getOrderDemandQueue já
// devolve nessa ordem, herdada da mesma prioridade que
// reconcileOrderReservations usa pra reserva de verdade). Só renderiza
// quando há alguma linha -- sem estado vazio, é um painel de "trabalho
// pendente", não uma listagem permanente.
export function DemandQueuePanel({ rows }: { rows: OrderDemandRow[] }) {
  if (rows.length === 0) return null

  return (
    <div className="tk-panel mt-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Peças pendentes de encomenda</h2>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{rows.length}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Ordenado pelo prazo de entrega mais próximo -- não pela ordem em que o pedido foi criado.</p>
      <div className="mt-3 space-y-2">
        {rows.map((row, i) => {
          const deadline = getDeadlineBadge(new Date(row.deliveryDate), row.status)
          const isPartial = row.reservedQuantity > 0
          return (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {row.productName}{row.partName && <span className="text-slate-500 dark:text-slate-400"> — Peça: {row.partName}</span>}
                  {row.comboLabel && <span className="text-violet-600 dark:text-violet-400"> — {row.comboLabel}</span>}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Pedido {ORDER_CHANNEL_LABELS[row.channel]}
                  {row.buyerOrPlatform ? ` · ${row.buyerOrPlatform}` : row.orderNumber ? ` · #${row.orderNumber}` : ' · sem comprador informado'}
                </p>
                {isPartial && (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (row.reservedQuantity / row.quantity) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{row.reservedQuantity} de {row.quantity} reservado</span>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{row.neededUnits} <span className="text-xs font-normal text-slate-400">falta produzir</span></p>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${deadline.className}`}>{deadline.label}</span>
                </div>
                <Link
                  href={`/production?${new URLSearchParams({
                    newRunProductId: row.productId,
                    ...(row.partId ? { newRunPartId: row.partId } : {}),
                    newRunQty: String(row.neededUnits),
                    ...(row.filamentIds && row.filamentIds.length === 1 ? { newRunFilamentId: row.filamentIds[0] } : {}),
                  }).toString()}`}
                  className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 dark:bg-violet-500 dark:text-slate-950 dark:hover:bg-violet-400"
                >
                  Registrar produção
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
