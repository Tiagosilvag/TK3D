import Link from 'next/link'
import type { AccessoryDemandRow } from '@/actions/orders'

// Pedido do usuário "aviso de acessório insuficiente, como o de produção,
// mas em Produção -- preciso saber ao criar o pedido pra me organizar":
// acessório (item comprado, nunca impresso) não tinha nenhum aviso antes da
// Montagem -- getAccessoryDemandQueue (actions/orders.ts) já soma a
// necessidade de todos os pedidos pendentes por acessório e compara contra
// o estoque real agora; aqui só lista o resultado, com link direto pra
// repor (abre o formulário de compra do acessório em /accessories).
// Server Component puro (sem estado) -- diferente de DemandQueuePanel
// (seleção em lote), aqui é só visibilidade + 1 link por linha.
export function AccessoryDemandPanel({ rows }: { rows: AccessoryDemandRow[] }) {
  if (rows.length === 0) return null

  return (
    <div className="tk-panel mt-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Acessórios insuficientes para pedidos pendentes</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">{rows.length}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
        Acessório não entra na fila de produção -- precisa ser comprado. Avisa já ao registrar o pedido, não só na hora da montagem.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.accessoryId} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-500/5">
            <div className="flex min-w-0 items-start gap-2">
              {row.colorHex && <span style={{ background: row.colorHex }} className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {row.accessoryName}{row.colorName && <span className="text-slate-500 dark:text-slate-400"> — {row.colorName}</span>}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {row.orders
                    .map((o) => o.buyerOrPlatform ?? (o.orderNumber ? `#${o.orderNumber}` : null))
                    .filter((label): label is string => Boolean(label))
                    .join(', ') || `${row.orders.length} pedido(s)`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  Faltam {row.missingUnits} <span className="text-xs font-normal text-slate-400 dark:text-slate-500">({row.availableUnits} de {row.neededUnits})</span>
                </p>
              </div>
              <Link
                href={`/accessories?restock=${row.accessoryId}`}
                className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
              >
                Repor estoque
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
