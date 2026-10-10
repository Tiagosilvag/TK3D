'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import type { ConsignmentHistoryEvent } from '@/lib/reports'
import { deleteConsignmentSaleReport } from '@/actions/consignmentSaleReports'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

const TYPE_LABELS = { entrega: 'Entrega', venda: 'Venda' } as const
const TYPE_BADGE_CLASSES = {
  entrega: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
  venda: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
} as const

interface DayGroup {
  key: string
  date: Date
  type: 'entrega' | 'venda'
  events: ConsignmentHistoryEvent[]
  quantity: number
  productCount: number
  value: number
  cost: number
  profit: number
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function groupByDay(history: ConsignmentHistoryEvent[]): DayGroup[] {
  const groups = new Map<string, DayGroup>()
  for (const event of history) {
    const key = `${dateKey(event.date)}::${event.type}`
    const group = groups.get(key) ?? { key, date: event.date, type: event.type, events: [], quantity: 0, productCount: 0, value: 0, cost: 0, profit: 0 }
    group.events.push(event)
    group.quantity += event.quantity
    group.value += event.value
    group.cost += event.cost ?? 0
    group.profit += event.profit ?? 0
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.productCount = new Set(group.events.map((e) => e.productId)).size
  }
  return [...groups.values()].sort((a, b) => b.date.getTime() - a.date.getTime())
}

// Melhoria "Histórico agrupado por dia": antes era 1 linha por PEÇA (nomes
// de cor enormes, dezenas de linhas pra uma entrega/venda de lote grande) --
// agora 1 linha por dia+tipo (entrega E venda no mesmo dia viram 2 linhas,
// nunca somadas juntas, já que são operações diferentes), com o total do
// dia (peças/produtos/valor) e a lista completa (produto, cor, qtd., valor,
// "Desfazer") só ao expandir. Valor/custo/lucro de cada evento já vêm
// calculados de getConsignmentPartnerDetail (lib/reports.ts) -- este
// componente só agrupa e soma, nenhuma fórmula nova aqui.
export function PartnerHistorySection({ history }: { history: ConsignmentHistoryEvent[] }) {
  const router = useRouter()
  const groups = useMemo(() => groupByDay(history), [history])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function handleUndoSale(id: string) {
    const result = await deleteConsignmentSaleReport(id)
    if (result.success) router.refresh()
    return result
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div className="tk-panel p-4">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Histórico</h2>
        <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Nenhum evento registrado ainda.</p>
      </div>
    )
  }

  return (
    <div className="tk-panel p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Histórico</h2>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Uma linha por dia. Clique para ver as peças.</p>

      <div className="mt-3 space-y-2">
        {groups.map((group) => {
          const isOpen = expanded.has(group.key)
          return (
            <div key={group.key} className="rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => toggle(group.key)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="flex items-center gap-2.5 text-sm">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{group.date.toLocaleDateString('pt-BR')}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE_CLASSES[group.type]}`}>{TYPE_LABELS[group.type]}</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{group.quantity} peças · {group.productCount} {group.productCount === 1 ? 'produto' : 'produtos'}</span>
                </span>
                <span className="flex items-center gap-4 text-xs">
                  {group.type === 'venda' ? (
                    <>
                      <span className="text-slate-500 dark:text-slate-400">vendido <span className="font-medium text-slate-900 dark:text-slate-100">{formatCurrency(group.value)}</span></span>
                      <span className="text-emerald-600 dark:text-emerald-400">meu lucro <span className="font-medium">{formatCurrency(group.profit)}</span></span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-500 dark:text-slate-400">a preço de venda <span className="font-medium text-slate-900 dark:text-slate-100">{formatCurrency(group.value)}</span></span>
                      <span className="text-slate-500 dark:text-slate-400">custo <span className="font-medium text-slate-900 dark:text-slate-100">{formatCurrency(group.cost)}</span></span>
                    </>
                  )}
                  <span className="text-slate-300 dark:text-slate-600" aria-hidden>{isOpen ? '▴' : '▾'}</span>
                </span>
              </button>

              {isOpen && (
                <div className="space-y-1.5 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                  {group.events.map((event, i) => (
                    <div key={`${event.id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">
                        {event.productName}{event.colorLabel ? ` — ${event.colorLabel}` : ''}
                        <span className="ml-1 text-slate-400 dark:text-slate-500">× {event.quantity}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{formatCurrency(event.value)}</span>
                        {event.type === 'venda' && (
                          <ConfirmDeleteForm
                            action={() => handleUndoSale(event.id)}
                            label="Desfazer"
                            className="font-medium text-red-600 hover:underline dark:text-red-400"
                            confirmMessage="Desfazer esta venda? A quantidade volta pro saldo com o parceiro."
                          />
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
