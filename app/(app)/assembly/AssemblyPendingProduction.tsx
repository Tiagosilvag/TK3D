import Link from 'next/link'
import type { OrderDemandRow } from '@/actions/orders'

// "Aguardando produção": peças que faltam pra montar os pedidos. Não é uma
// lista à parte -- é a MESMA pendência que a Produção mostra (derivada dos
// pedidos e das produções existentes), já com a cor que o pedido pediu --, então
// produzir (ou editar/excluir uma produção) atualiza esta lista sozinha.
export function AssemblyPendingProduction({ rows, colorHexById }: { rows: OrderDemandRow[]; colorHexById: Record<string, string | null> }) {
  const pieces = rows.filter((r) => r.partId !== null)
  if (pieces.length === 0) return null

  return (
    <div className="tk-panel mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Aguardando produção</h2>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{pieces.length}</span>
        </div>
        <Link href="/production" className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">Ir para Produção →</Link>
      </div>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Peças que faltam para montar os pedidos, já com a cor pedida. Saem daqui quando forem produzidas.</p>
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        {pieces.map((r) => (
          <li key={`${r.orderItemId}:${r.partId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-slate-900 dark:text-slate-100">{r.productName}</span>
              <span className="text-slate-500 dark:text-slate-400"> · {r.partName}</span>
              {r.comboLabel && (
                <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {(r.filamentIds ?? []).map((id) => (
                    <span key={id} style={colorHexById[id] ? { background: colorHexById[id]! } : undefined} className="inline-block h-3 w-3 rounded-full border border-black/15 dark:border-white/20" />
                  ))}
                  {r.comboLabel}
                </span>
              )}
            </span>
            <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">falta <b className="text-slate-900 dark:text-slate-100">{r.neededUnits}</b></span>
          </li>
        ))}
      </ul>
    </div>
  )
}
