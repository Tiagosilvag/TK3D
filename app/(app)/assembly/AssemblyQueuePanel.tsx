'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getDeadlineBadge, ORDER_CHANNEL_LABELS } from '@/lib/format'
import type { AssemblyQueueItem } from '@/actions/orders'
import { assembleOrderItem, assembleOrderItems, undoAssemblies, getAssemblyItemParts, type AssemblyItemPartRow } from '@/actions/assembly'
import { UndoToast } from '@/components/UndoToast'

// Fila de montagem: itens de pedido que precisam de montagem, do prazo mais
// próximo ao mais distante, com o status calculado ao vivo pra variação que
// o cliente pediu. "✓ Montar N" monta na hora (variação do pedido, padrões da
// ficha, insumos padrão) e mostra "Desfazer" por 10 s.
function canAssemble(item: AssemblyQueueItem): number {
  return Math.min(item.shortfall, item.assemblableUnits)
}

export function AssemblyQueuePanel({ items }: { items: AssemblyQueueItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; ids: string[] } | null>(null)
  // "Ver peças": carregado sob demanda, 1 vez por item.
  const [openParts, setOpenParts] = useState<Record<string, AssemblyItemPartRow[] | 'loading'>>({})

  async function toggleParts(orderItemId: string) {
    if (openParts[orderItemId]) {
      setOpenParts((prev) => { const { [orderItemId]: _drop, ...rest } = prev; void _drop; return rest })
      return
    }
    setOpenParts((prev) => ({ ...prev, [orderItemId]: 'loading' }))
    const rows = await getAssemblyItemParts(orderItemId)
    setOpenParts((prev) => ({ ...prev, [orderItemId]: rows }))
  }

  const ready = items.filter((i) => canAssemble(i) > 0)

  async function finish(result: { success: boolean; error?: string; assemblyIds?: string[]; assemblyId?: string; units?: number }) {
    if (!result.success) {
      setError(result.error ?? 'Não foi possível montar.')
      return
    }
    const ids = result.assemblyIds ?? (result.assemblyId ? [result.assemblyId] : [])
    const units = result.units ?? 0
    setToast({ message: `${units} ${units === 1 ? 'unidade montada' : 'unidades montadas'}.`, ids })
    router.refresh()
  }

  async function assembleOne(item: AssemblyQueueItem) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await finish(await assembleOrderItem(item.orderItemId))
    } finally {
      setBusy(false)
    }
  }

  async function assembleAll() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await finish(await assembleOrderItems(ready.map((i) => i.orderItemId)))
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    const ids = toast?.ids ?? []
    setToast(null)
    if (ids.length === 0) return
    const result = await undoAssemblies(ids)
    if (!result.success) setError(result.error ?? 'Não foi possível desfazer.')
    router.refresh()
  }

  if (items.length === 0) {
    return toast ? <UndoToast message={toast.message} onUndo={undo} onDismiss={() => setToast(null)} durationMs={10000} /> : null
  }

  return (
    <div className="tk-panel mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Fila de montagem</h2>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{items.length}</span>
        </div>
        {ready.length >= 2 && (
          <button type="button" disabled={busy} onClick={assembleAll} className="tk-btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
            ✓ Montar todos os prontos ({ready.length})
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
        Pedidos que precisam de montagem, do prazo mais próximo ao mais distante. ✓ Montar usa a variação que o cliente pediu.
      </p>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const deadline = getDeadlineBadge(new Date(item.deliveryDate), item.status)
          const units = canAssemble(item)
          const all = item.assemblableUnits >= item.shortfall
          const missing = item.missingParts.map((m) => `${m.name} (${m.units})`).join(', ')
          const adjustHref = `/assembly?${new URLSearchParams({
            productId: item.productId,
            qty: String(item.shortfall),
            ...(item.colorComboKey ? { presetColorComboKey: item.colorComboKey } : {}),
          }).toString()}`
          return (
            <li key={item.orderItemId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  <span className="truncate">{item.productName}</span>
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    × {item.shortfall} · {ORDER_CHANNEL_LABELS[item.channel]}
                    {item.buyerOrPlatform ? ` · ${item.buyerOrPlatform}` : item.orderNumber ? ` · #${item.orderNumber}` : ''}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${deadline.className}`}>{deadline.label}</span>
                </p>
                <button type="button" onClick={() => void toggleParts(item.orderItemId)} className="mt-0.5 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                  {openParts[item.orderItemId] ? 'Ocultar peças' : 'Ver peças'}
                </button>
                {all ? (
                  <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">Dá para montar tudo agora</p>
                ) : units > 0 ? (
                  <p className="mt-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">Dá para montar {units} de {item.shortfall}{missing && ` · falta ${missing}`}</p>
                ) : (
                  <p className="mt-0.5 text-xs font-medium text-red-600 dark:text-red-400">Não dá para montar{missing && ` · falta ${missing}`}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs font-medium">
                <Link href={adjustHref} className="text-violet-600 hover:underline dark:text-violet-400">Ajustar</Link>
                {item.missingParts.length > 0 && (
                  <Link href="/production" className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                    → Produção
                  </Link>
                )}
                {units > 0 && (
                  <button type="button" disabled={busy} onClick={() => assembleOne(item)} className="tk-btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
                    ✓ Montar {units}
                  </button>
                )}
              </div>
              {openParts[item.orderItemId] && (
                <div className="basis-full rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                  {openParts[item.orderItemId] === 'loading' ? (
                    <p className="text-xs text-slate-400">Carregando…</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {(openParts[item.orderItemId] as AssemblyItemPartRow[]).map((p) => (
                        <li key={p.partId} className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {p.name}
                            {p.quantityPerUnit !== 1 && <span className="ml-1 font-normal text-slate-400">× {p.quantityPerUnit}</span>}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-1.5">
                            {p.colors.map((c, i) => (
                              <span key={i} style={c.hex ? { background: c.hex } : undefined} title={c.name} className="inline-block h-3.5 w-3.5 rounded-full border border-black/15 dark:border-white/20" />
                            ))}
                            <span className="text-slate-500 dark:text-slate-400">{p.label ?? '—'}</span>
                            <span className={p.available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-600 dark:text-red-400'}>{p.available} disp.</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {toast && <UndoToast message={toast.message} onUndo={undo} onDismiss={() => setToast(null)} durationMs={10000} />}
    </div>
  )
}
