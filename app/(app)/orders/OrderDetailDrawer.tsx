'use client'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, getOrderItemDisplayStatus, ORDER_CHANNEL_LABELS } from '@/lib/format'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { Drawer } from '@/components/Drawer'
import { Stepper } from '@/components/Stepper'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { updateOrderDraft, updateOrderItemStatus, updateDeliveredItemPrice, getOrderEditHistory } from '@/actions/orders'
import type { OrderRow } from './OrdersExplorer'

// Redesign "Pedidos" §2 -- drawer lateral de detalhe: itens SEMPRE
// editáveis (sem "modo edição" separado -- diferente do <dialog> antigo
// que esta tela substitui, onde cada item salvava sozinho na hora).
// quantidade/valor ficam num rascunho local (`draft`), só gravados no
// clique de "Salvar alterações" -- reaproveita updateOrderDraft
// (actions/orders.ts), que já aplica a MESMA guarda de
// updateOrderItem/removeOrderItem (bloqueado se saleId/
// consignmentDeliveryId) e grava 1 OrderEditLog cobrindo a sessão
// inteira. "+ Adicionar item ao pedido" continua sendo o fluxo imediato
// que já existia (OrderForm em modo existingOrder, gerenciado pelo
// componente pai) -- não entra no rascunho, grava na hora, mesmo
// comportamento de antes.
const DELIVERY_CHIPS = [
  { label: 'Hoje', days: 0 },
  { label: 'Amanhã', days: 1 },
  { label: 'Em 2 dias', days: 2 },
  { label: 'Em 4 dias', days: 4 },
  { label: 'Semana que vem', days: 7 },
]

function addDays(days: number): string {
  const d = new Date(`${today()}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
  }`
}

type ItemDraft = { quantity: number; unitPrice: number }

// Item travado (saleId/consignmentDeliveryId) nunca passa pelo rascunho de
// "Salvar alterações" -- edita o valor na hora, direto (updateDeliveredItemPrice,
// ver startEditPrice/savePrice abaixo). Excluído da POPULAÇÃO inicial de
// `drafts` de propósito: se draft[id] nunca existe pra um item travado, os
// fallbacks `drafts[id]?.X ?? item.X` espalhados pelo componente sempre
// leem o valor atual de `order` (já atualizado por router.refresh() depois
// da edição imediata) -- nunca um valor congelado no momento em que o
// drawer abriu, que ficaria "diferente" do servidor e acionaria um
// "Salvar alterações" fantasma sem nada de fato pendente.
function isLocked(item: { saleId: string | null; consignmentDeliveryId: string | null }): boolean {
  return Boolean(item.saleId || item.consignmentDeliveryId)
}

export function OrderDetailDrawer({
  order,
  open,
  onClose,
  onAddItem,
}: {
  order: OrderRow | null
  open: boolean
  onClose: () => void
  onAddItem: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({})
  const [deliveryDate, setDeliveryDate] = useState('')
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [history, setHistory] = useState<{ id: string; changes: { label: string; from: string; to: string }[]; createdAt: Date }[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(true)
  // Pedido do usuário "opção de editar o valor mesmo depois de entregue":
  // item travado (saleId/consignmentDeliveryId) continua com quantidade
  // fixa, mas o VALOR ganha edição inline própria -- imediata (grava na
  // hora, igual markDelivered), fora do rascunho/"Salvar alterações" de
  // cima, já que é uma correção pontual, não parte de uma sessão de
  // edição do pedido em aberto.
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [priceInput, setPriceInput] = useState('')

  // Reseta o rascunho sempre que um pedido DIFERENTE é aberto (ou o
  // drawer fecha) -- nunca carrega draft de um pedido pro outro.
  useEffect(() => {
    if (!order) return
    setDrafts(Object.fromEntries(order.items.filter((i) => !isLocked(i)).map((i) => [i.id, { quantity: i.quantity, unitPrice: i.unitPrice }])))
    setDeliveryDate(order.deliveryDate.slice(0, 10))
    setRemovedIds(new Set())
    setError(null)
    setSavedAt(null)
    setHistory(null)
    setEditingPriceId(null)
    getOrderEditHistory(order.id).then(setHistory)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o ID muda pra outro pedido, não a cada nova referência de `order` (ex.: router.refresh() do pai) -- senão um draft não salvo seria resetado sozinho.
  }, [order?.id])

  const activeItems = useMemo(() => (order ? order.items.filter((i) => !removedIds.has(i.id)) : []), [order, removedIds])

  const hasChanges = useMemo(() => {
    if (!order) return false
    if (removedIds.size > 0) return true
    if (deliveryDate !== order.deliveryDate.slice(0, 10)) return true
    return order.items.some((i) => {
      const d = drafts[i.id]
      return d && (d.quantity !== i.quantity || d.unitPrice !== i.unitPrice)
    })
  }, [order, drafts, deliveryDate, removedIds])

  const draftTotal = useMemo(() => activeItems.reduce((sum, i) => sum + (drafts[i.id]?.quantity ?? i.quantity) * (drafts[i.id]?.unitPrice ?? i.unitPrice), 0), [activeItems, drafts])
  const originalTotal = useMemo(() => (order ? order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) : 0), [order])

  function updateDraft(id: string, patch: Partial<ItemDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function discard() {
    if (!order) return
    setDrafts(Object.fromEntries(order.items.filter((i) => !isLocked(i)).map((i) => [i.id, { quantity: i.quantity, unitPrice: i.unitPrice }])))
    setDeliveryDate(order.deliveryDate.slice(0, 10))
    setRemovedIds(new Set())
    setError(null)
  }

  function save() {
    if (!order) return
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      const itemUpdates = order.items
        .filter((i) => !removedIds.has(i.id))
        .map((i) => ({ id: i.id, quantity: drafts[i.id]?.quantity ?? i.quantity, unitPrice: drafts[i.id]?.unitPrice ?? i.unitPrice }))
        .filter((u) => {
          const original = order.items.find((i) => i.id === u.id)!
          return u.quantity !== original.quantity || u.unitPrice !== original.unitPrice
        })
      fd.set('itemUpdatesJson', JSON.stringify(itemUpdates))
      fd.set('removedItemIdsJson', JSON.stringify([...removedIds]))
      if (deliveryDate !== order.deliveryDate.slice(0, 10)) fd.set('deliveryDate', deliveryDate)
      const result = await updateOrderDraft(order.id, fd)
      if (!result.success) return setError(result.error ?? 'Erro ao salvar alterações.')
      setSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
      setRemovedIds(new Set())
      getOrderEditHistory(order.id).then(setHistory)
      router.refresh()
    })
  }

  function markDelivered(itemId: string) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('status', 'ENTREGUE')
      await updateOrderItemStatus(itemId, fd)
      router.refresh()
    })
  }

  function startEditPrice(itemId: string, currentPrice: number) {
    setError(null)
    setEditingPriceId(itemId)
    setPriceInput(String(currentPrice))
  }

  function savePrice(itemId: string) {
    if (!order) return
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('unitPrice', priceInput)
      const result = await updateDeliveredItemPrice(itemId, fd)
      if (!result.success) return setError(result.error ?? 'Erro ao salvar valor.')
      setEditingPriceId(null)
      getOrderEditHistory(order.id).then(setHistory)
      router.refresh()
    })
  }

  if (!order) return null

  return (
    <Drawer open={open} onClose={onClose}>
      <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Pedido {order.orderNumber ? `#${order.orderNumber}` : ''}
            </h3>
            {order.editedAt && (
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                Editado {new Date(order.editedAt).toLocaleDateString('pt-BR')} {new Date(order.editedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {order.buyerOrPlatform ?? ORDER_CHANNEL_LABELS[order.channel]} · Feito em {new Date(order.createdAt).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
      </div>

      <div className="flex-1 space-y-4 p-4">
        {savedAt && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            ✓ Pedido atualizado às {savedAt}
          </div>
        )}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{error}</div>}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Itens do pedido</p>
          <div className="space-y-2">
            {order.items.map((item) => {
              if (removedIds.has(item.id)) {
                return (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400 line-through dark:border-slate-700 dark:text-slate-500">
                    <span>{item.productName}</span>
                    <button type="button" onClick={() => setRemovedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next })} className="font-medium text-violet-600 no-underline hover:underline dark:text-violet-400">
                      Desfazer
                    </button>
                  </div>
                )
              }
              const draft = drafts[item.id] ?? { quantity: item.quantity, unitPrice: item.unitPrice }
              const changed = draft.quantity !== item.quantity || draft.unitPrice !== item.unitPrice
              const locked = Boolean(item.saleId || item.consignmentDeliveryId)
              const display = getOrderItemDisplayStatus(item.status)
              const shrinking = draft.quantity < item.quantity && item.reservedQuantity > 0
              return (
                <div key={item.id} className={`rounded-lg border p-3 ${changed ? 'border-amber-300 dark:border-amber-700' : 'border-slate-200 dark:border-slate-700'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                        {item.colorHex && <span style={{ background: item.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                        <span className="truncate">{item.productName}{item.colorLabel && <span className="font-normal text-slate-500 dark:text-slate-400"> — {item.colorLabel}</span>}</span>
                        {changed && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">ALTERADO</span>}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${display.badgeClassName}`}>{display.label}</span>
                  </div>

                  {locked ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                      🔒 {item.quantity}un ×{' '}
                      {editingPriceId === item.id ? (
                        <>
                          <input
                            type="number" step="0.01" min="0.01" value={priceInput} autoFocus
                            onChange={(e) => setPriceInput(e.target.value)}
                            className="tk-input w-20 px-1.5 py-0.5 text-xs"
                          />
                          <button type="button" onClick={() => savePrice(item.id)} disabled={isPending} className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                            Salvar
                          </button>
                          <button type="button" onClick={() => setEditingPriceId(null)} className="hover:underline">Cancelar</button>
                        </>
                      ) : (
                        <>
                          <span>{formatCurrency(item.unitPrice)}</span>
                          <button type="button" onClick={() => startEditPrice(item.id, item.unitPrice)} aria-label="Editar valor" title="Editar valor" className="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400">✎</button>
                        </>
                      )}
                      <span>— já {item.saleId ? 'virou venda' : 'virou entrega de consignação'} (quantidade não editável aqui)</span>
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-4">
                        <label className="text-xs text-slate-500 dark:text-slate-400">
                          <span className="mb-1 block">Quantidade</span>
                          <Stepper value={draft.quantity} min={1} step={1} onChange={(v) => updateDraft(item.id, { quantity: v })} />
                        </label>
                        <label className="text-xs text-slate-500 dark:text-slate-400">
                          <span className="mb-1 block">Valor unitário</span>
                          <Stepper value={draft.unitPrice} min={0.01} step={1} onChange={(v) => updateDraft(item.id, { unitPrice: v })} />
                        </label>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          <span className="mb-1 block">Subtotal</span>
                          <span className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(draft.quantity * draft.unitPrice)}</span>
                        </div>
                      </div>
                      {shrinking && (
                        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">⚠ já está em produção — a sobra vai pro estoque disponível</p>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-xs">
                        {item.status === 'PRONTO_RESERVADO' && (
                          <button type="button" onClick={() => markDelivered(item.id)} disabled={isPending} className="font-medium text-emerald-600 hover:underline dark:text-emerald-400">
                            ✓ Marcar entregue
                          </button>
                        )}
                        <ConfirmDeleteForm
                          action={async () => { setRemovedIds((prev) => new Set(prev).add(item.id)); return { success: true } }}
                          label="Remover"
                          confirmMessage="Remover este item do pedido? Só é gravado quando você salvar as alterações."
                          className="text-red-600 hover:underline dark:text-red-400"
                        />
                      </div>
                      {item.reallocationsLost.map((r, i) => (
                        <p key={i} className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          ⚠ {r.quantity} peça{r.quantity === 1 ? '' : 's'} realocada{r.quantity === 1 ? '' : 's'} pro pedido {r.toOrderNumber ? `#${r.toOrderNumber}` : '(sem número)'}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            onClick={onAddItem}
            className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60"
          >
            + Adicionar item ao pedido
          </button>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Data de entrega</p>
          <div className="flex flex-wrap gap-2">
            {DELIVERY_CHIPS.map((c) => {
              const value = addDays(c.days)
              return (
                <button key={c.label} type="button" onClick={() => setDeliveryDate(value)} className={chipClass(deliveryDate === value)}>
                  {c.label}
                </button>
              )
            })}
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="tk-input px-2 py-1 text-xs" />
          </div>
        </div>

        {history && history.length > 0 && (
          <div>
            <button type="button" onClick={() => setHistoryOpen((v) => !v)} className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span>Histórico de alterações ({history.length})</span>
              <span className="font-normal normal-case text-violet-600 dark:text-violet-400">{historyOpen ? 'Ocultar' : 'Mostrar'}</span>
            </button>
            {historyOpen && (
              <div className="space-y-2 text-xs">
                {history.map((log) => (
                  <div key={log.id} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <p className="text-slate-400 dark:text-slate-500">{new Date(log.createdAt).toLocaleDateString('pt-BR')} {new Date(log.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                    {log.changes.map((c, i) => (
                      <p key={i} className="text-slate-700 dark:text-slate-300">{c.label}: {c.from} → {c.to}</p>
                    ))}
                  </div>
                ))}
                <div className="rounded-lg bg-slate-50 p-2 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
                  {new Date(order.createdAt).toLocaleDateString('pt-BR')} · Pedido criado
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {hasChanges && (
          <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Total novo: <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(draftTotal)}</span>{' '}
            <span className="line-through">{formatCurrency(originalTotal)}</span>{' '}
            <span className={draftTotal >= originalTotal ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              ({draftTotal >= originalTotal ? '+' : ''}{formatCurrency(draftTotal - originalTotal)})
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Total do pedido: {formatCurrency(draftTotal)}</span>
          <div className="flex gap-3">
            <button type="button" onClick={discard} disabled={!hasChanges} className="text-sm text-slate-500 hover:underline disabled:opacity-40 dark:text-slate-400">Descartar</button>
            <button type="button" onClick={save} disabled={!hasChanges || isPending} className="tk-btn-primary px-3 py-1.5 text-sm disabled:opacity-40">
              {isPending ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </Drawer>
  )
}
