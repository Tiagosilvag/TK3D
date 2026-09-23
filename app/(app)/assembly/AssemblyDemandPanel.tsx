import Link from 'next/link'
import { getDeadlineBadge, ORDER_CHANNEL_LABELS } from '@/lib/format'
import type { OrderDemandRow } from '@/actions/orders'

// Melhoria "Pedidos com reserva de estoque" §3: painel "Prontas pra
// montar por encomenda" no topo de Montagem -- mesma lógica do painel de
// Produção, só que com peça que JÁ existe (produzida, esperando
// montagem) e só falta a montagem pra fechar o pedido. "Montar agora"
// leva pro detalhe do produto (?productId=).
//
// Encomenda com variação personalizada: quando o pedido tem uma
// combinação de cor específica (colorComboKey), o link também leva
// ?presetColorComboKey= -- ConfirmAssemblyForm pré-seleciona a
// combinação certa por peça (deserializeColorChoices), em vez da
// heurística "maior estoque" de sempre, pra não escolher a cor errada
// por acidente (a reserva em si já é automática via
// reconcileOrderReservations, isso só guia a escolha).
export function AssemblyDemandPanel({ rows }: { rows: OrderDemandRow[] }) {
  if (rows.length === 0) return null

  return (
    <div className="tk-panel mb-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Prontas pra montar por encomenda</h2>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{rows.length}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">As peças já existem -- só falta a montagem pra reservar pro pedido.</p>
      <div className="mt-3 space-y-2">
        {rows.map((row, i) => {
          const deadline = getDeadlineBadge(new Date(row.deliveryDate), row.status)
          const isPartial = row.reservedQuantity > 0
          return (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{row.productName}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Pedido {ORDER_CHANNEL_LABELS[row.channel]}
                  {row.buyerOrPlatform ? ` · ${row.buyerOrPlatform}` : row.orderNumber ? ` · #${row.orderNumber}` : ''}
                </p>
                {isPartial && (
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{row.reservedQuantity} de {row.quantity} reservado</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{row.neededUnits} <span className="text-xs font-normal text-slate-400">prontas p/ montar</span></p>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${deadline.className}`}>{deadline.label}</span>
                </div>
                <Link
                  href={`/assembly?${new URLSearchParams({
                    productId: row.productId,
                    ...(row.colorComboKey ? { presetColorComboKey: row.colorComboKey } : {}),
                  }).toString()}`}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                >
                  Montar agora
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
