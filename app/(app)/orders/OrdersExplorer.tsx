'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, getDeadlineBadge, getOrderItemDisplayStatus, ORDER_CHANNEL_LABELS } from '@/lib/format'
import { todayInBrasilia } from '@/lib/timezone'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { ActionsMenu } from '@/components/ActionsMenu'
import { UndoToast } from '@/components/UndoToast'
import { OrderForm, type OrderProductOption } from './OrderForm'
import { OrderDetailDrawer } from './OrderDetailDrawer'
import { deleteOrder, cancelOrder, updateOrderItemStatus, undoOrderItemDelivery } from '@/actions/orders'
import type { OrderChannel, OrderStatus } from '@prisma/client'

export interface OrderReallocationTag {
  quantity: number
  toOrderNumber: string | null
  createdAt: string
}

export interface OrderItemRow {
  id: string
  productName: string
  colorLabel: string | null
  colorComboKey: string | null
  colorHex: string | null
  quantity: number
  reservedQuantity: number
  unitPrice: number
  status: OrderStatus
  saleId: string | null
  // Pedido do usuário "criar pedidos de encomendas de consignados
  // também": mesmo papel de saleId acima, pro pedido canal CONSIGNADO --
  // ao chegar em ENTREGUE, um dos dois (nunca os dois) fica preenchido.
  consignmentDeliveryId: string | null
  reallocationsLost: OrderReallocationTag[]
}

export interface OrderRow {
  id: string
  orderNumber: string | null
  orderDate: string
  deliveryDate: string
  createdAt: string
  // Redesign "Pedidos" -- badge "Editado" + "↳ o que mudou": derivado do
  // OrderEditLog mais recente (page.tsx), nunca recalculado no client.
  editedAt: string | null
  lastChangeSummary: string | null
  channel: OrderChannel
  buyerOrPlatform: string | null
  notes: string | null
  items: OrderItemRow[]
}

const TERMINAL: OrderStatus[] = ['ENTREGUE', 'CANCELADO']
// Do pior pro melhor -- usado pra achar o status "mais atrasado" entre os
// itens ainda ativos, pra decidir o status agregado do pedido (usado só
// pro filtro/card "Prontos pra entregar" e pro botão "✓ Entregar tudo").
const STATUS_PRIORITY: OrderStatus[] = ['RECEBIDO', 'EM_PRODUCAO', 'PRONTO', 'DESPACHADO', 'AGUARDANDO_PRODUCAO', 'PARCIAL_AGUARDANDO_PRODUCAO', 'AGUARDANDO_MONTAGEM', 'PRONTO_RESERVADO']

function aggregateStatus(items: OrderItemRow[]): OrderStatus {
  const active = items.filter((i) => i.status !== 'CANCELADO')
  if (active.length === 0) return 'CANCELADO'
  if (active.every((i) => i.status === 'ENTREGUE')) return 'ENTREGUE'
  const pending = active.filter((i) => i.status !== 'ENTREGUE')
  for (const s of STATUS_PRIORITY) {
    if (pending.some((i) => i.status === s)) return s
  }
  return pending[0]?.status ?? 'AGUARDANDO_PRODUCAO'
}

// Mesmo critério de getDeadlineBadge (lib/format.ts) -- "hoje" em
// Brasília, nunca o fuso da máquina rodando o navegador.
function daysUntil(dateStr: string): number {
  const msPerDay = 1000 * 60 * 60 * 24
  const nowDate = todayInBrasilia()
  const delivery = new Date(dateStr)
  delivery.setUTCHours(0, 0, 0, 0)
  return Math.round((delivery.getTime() - nowDate.getTime()) / msPerDay)
}

function itemNeedsProduction(item: OrderItemRow): boolean {
  return item.status !== 'CANCELADO' && item.status !== 'ENTREGUE' && item.quantity > item.reservedQuantity
}

// Redesign "Pedidos" §1 -- barra de linha segmentada: 1 segmento por item
// do pedido (nunca 1 badge só pro pedido inteiro), colorido pelas 4 cores
// de getOrderItemDisplayStatus -- estende o padrão de barra única de
// DemandQueuePanel.tsx (track h-1.5 rounded-full) pra um `flex` de N
// `span`s.
function SegmentedBar({ items }: { items: OrderItemRow[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      {items.map((item, i) => (
        <span
          key={item.id}
          style={{ width: `${100 / items.length}%` }}
          className={`${getOrderItemDisplayStatus(item.status).barClassName} ${i > 0 ? 'border-l border-white/50 dark:border-slate-900/50' : ''}`}
        />
      ))}
    </div>
  )
}

function whatRemainsLabel(items: OrderItemRow[]): string | null {
  const names = items.filter(itemNeedsProduction).map((i) => i.productName)
  if (names.length === 0) return null
  return `Falta: ${names.join(', ')}`
}

type CardFilter = 'ATRASADOS' | 'HOJE' | 'FALTA_PRODUZIR' | 'PRONTOS' | null

function AttentionCard({ label, value, unit, tone, active, onClick }: { label: string; value: number; unit: string; tone: 'red' | 'amber' | 'violet' | 'sky'; active: boolean; onClick: () => void }) {
  const toneClass = {
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
    violet: 'text-violet-600 dark:text-violet-400',
    sky: 'text-sky-600 dark:text-sky-400',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tk-panel p-4 text-left transition-colors ${active ? 'ring-2 ring-violet-500' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
    >
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${value > 0 ? toneClass : 'text-slate-900 dark:text-slate-100'}`}>{value}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500">{unit}</p>
    </button>
  )
}

function OrderRowCard({
  row,
  status,
  onOpen,
  onDeliverAll,
  isPending,
}: {
  row: OrderRow
  status: OrderStatus
  onOpen: () => void
  onDeliverAll: () => void
  isPending: boolean
}) {
  const deadline = getDeadlineBadge(new Date(row.deliveryDate), status)
  const total = row.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const anySale = row.items.some((i) => i.saleId || i.consignmentDeliveryId)
  const remains = whatRemainsLabel(row.items)
  const canDeliverAll = status === 'PRONTO_RESERVADO'

  return (
    <div className="tk-panel cursor-pointer p-4" onClick={onOpen}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {row.buyerOrPlatform ?? ORDER_CHANNEL_LABELS[row.channel]}
            </span>
            {row.orderNumber && <span className="text-xs text-slate-400 dark:text-slate-500">#{row.orderNumber}</span>}
            <span className="text-xs text-slate-400 dark:text-slate-500">{new Date(row.orderDate).toLocaleDateString('pt-BR')}</span>
            {!TERMINAL.includes(status) && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${deadline.className}`}>{deadline.label}</span>
            )}
            {row.editedAt && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                Editado {new Date(row.editedAt).toLocaleDateString('pt-BR')} {new Date(row.editedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
            {row.items.length === 1 ? '1 item' : `${row.items.length} itens`} · {row.items.map((i) => i.productName).join(', ')}
          </p>
          {row.lastChangeSummary && (
            <p className="mt-0.5 truncate text-xs text-amber-600 dark:text-amber-400">↳ {row.lastChangeSummary}</p>
          )}
          <div className="mt-2 max-w-sm">
            <SegmentedBar items={row.items} />
          </div>
          {remains && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{remains}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <span className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(total)}</span>
          <div className="flex items-center gap-1">
            {canDeliverAll && (
              <button type="button" onClick={onDeliverAll} disabled={isPending} className="whitespace-nowrap text-xs font-medium text-emerald-600 hover:underline disabled:opacity-40 dark:text-emerald-400">
                ✓ Entregar tudo
              </button>
            )}
            <button type="button" onClick={onOpen} aria-label="Editar pedido" title="Editar" className="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400">✎</button>
            <ActionsMenu>
              {!anySale && !TERMINAL.includes(status) && (
                <ConfirmDeleteForm
                  action={async () => await cancelOrder(row.id)}
                  label="Cancelar"
                  confirmMessage="Cancelar os itens pendentes deste pedido? A peça reservada volta pro estoque disponível."
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-amber-600 hover:bg-slate-100 dark:text-amber-400 dark:hover:bg-slate-800"
                />
              )}
              {!anySale && (
                <ConfirmDeleteForm
                  action={async () => await deleteOrder(row.id)}
                  label="Excluir"
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-red-600 hover:bg-slate-100 dark:text-red-400 dark:hover:bg-slate-800"
                />
              )}
              {anySale && TERMINAL.includes(status) && (
                <span className="px-2 py-1.5 text-xs text-slate-400 dark:text-slate-500">Sem ações disponíveis</span>
              )}
            </ActionsMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

// Redesign "Pedidos" §1: cards de atenção no topo (também filtros por
// clique), pedidos agrupados por urgência (Atrasados/Hoje/Próximos,
// Entregues ocultos por padrão) em vez da tabela+abas antiga -- clique na
// linha abre o OrderDetailDrawer (substitui o <dialog> de detalhe antigo).
export function OrdersExplorer({
  rows,
  products,
  partners,
  recentBuyers,
}: {
  rows: OrderRow[]
  products: OrderProductOption[]
  partners: { id: string; name: string }[]
  recentBuyers: string[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [formOpen, setFormOpen] = useState(false)
  // Pedido do usuário "editar pedido pra adicionar peça": 2ª instância do
  // mesmo OrderForm, em modo existingOrder (sem campos de cabeçalho) --
  // aberta pelo botão "+ Adicionar item" dentro do drawer de detalhe.
  const [addItemOpen, setAddItemOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [cardFilter, setCardFilter] = useState<CardFilter>(null)
  const [showDelivered, setShowDelivered] = useState(false)
  const [toast, setToast] = useState<{ label: string; itemIds: string[] } | null>(null)

  const selected = useMemo(() => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null), [rows, selectedId])

  function openDetail(id: string) {
    setSelectedId(id)
    setDrawerOpen(true)
  }

  const rowsWithStatus = useMemo(() => rows.map((r) => ({ row: r, status: aggregateStatus(r.items) })), [rows])
  const openRows = useMemo(() => rowsWithStatus.filter((r) => !TERMINAL.includes(r.status)), [rowsWithStatus])

  const lateRows = useMemo(() => openRows.filter((r) => daysUntil(r.row.deliveryDate) < 0), [openRows])
  const todayRows = useMemo(() => openRows.filter((r) => daysUntil(r.row.deliveryDate) === 0), [openRows])
  const shortfallRows = useMemo(() => openRows.filter((r) => r.row.items.some(itemNeedsProduction)), [openRows])
  const shortfallItemsCount = useMemo(() => openRows.reduce((sum, r) => sum + r.row.items.filter(itemNeedsProduction).length, 0), [openRows])
  const readyRows = useMemo(() => openRows.filter((r) => r.status === 'PRONTO_RESERVADO'), [openRows])

  const cardFiltered = useMemo(() => {
    if (cardFilter === 'ATRASADOS') return lateRows
    if (cardFilter === 'HOJE') return todayRows
    if (cardFilter === 'FALTA_PRODUZIR') return shortfallRows
    if (cardFilter === 'PRONTOS') return readyRows
    return rowsWithStatus
  }, [cardFilter, lateRows, todayRows, shortfallRows, readyRows, rowsWithStatus])

  const groups = useMemo(() => {
    const byDeadline = <T extends { row: OrderRow }>(arr: T[]) => [...arr].sort((a, b) => new Date(a.row.deliveryDate).getTime() - new Date(b.row.deliveryDate).getTime())
    const active = cardFiltered.filter((r) => !TERMINAL.includes(r.status))
    const finalized = cardFiltered.filter((r) => TERMINAL.includes(r.status))
    return {
      atrasados: byDeadline(active.filter((r) => daysUntil(r.row.deliveryDate) < 0)),
      hoje: byDeadline(active.filter((r) => daysUntil(r.row.deliveryDate) === 0)),
      proximos: byDeadline(active.filter((r) => daysUntil(r.row.deliveryDate) > 0)),
      finalized: byDeadline(finalized),
    }
  }, [cardFiltered])

  const totalVisible = groups.atrasados.length + groups.hoje.length + groups.proximos.length

  function deliverAll(row: OrderRow) {
    const ids = row.items.filter((i) => i.status !== 'CANCELADO' && i.status !== 'ENTREGUE').map((i) => i.id)
    if (ids.length === 0) return
    startTransition(async () => {
      for (const id of ids) {
        const fd = new FormData()
        fd.set('status', 'ENTREGUE')
        await updateOrderItemStatus(id, fd)
      }
      router.refresh()
      setToast({ label: `Pedido ${row.orderNumber ? `#${row.orderNumber}` : ''} entregue`, itemIds: ids })
    })
  }

  function undoDeliverAll() {
    if (!toast) return
    const ids = toast.itemIds
    setToast(null)
    startTransition(async () => {
      for (const id of ids) await undoOrderItemDelivery(id)
      router.refresh()
    })
  }

  function toggleCard(filter: CardFilter) {
    setCardFilter((prev) => (prev === filter ? null : filter))
  }

  function renderSection(label: string, items: { row: OrderRow; status: OrderStatus }[]) {
    if (items.length === 0) return null
    return (
      <div key={label} className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label} ({items.length})</p>
        <div className="space-y-2">
          {items.map(({ row, status }) => (
            <OrderRowCard
              key={row.id}
              row={row}
              status={status}
              isPending={isPending}
              onOpen={() => openDetail(row.id)}
              onDeliverAll={() => deliverAll(row)}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <AttentionCard label="Atrasados" value={lateRows.length} unit="pedidos" tone="red" active={cardFilter === 'ATRASADOS'} onClick={() => toggleCard('ATRASADOS')} />
        <AttentionCard label="Para entregar hoje" value={todayRows.length} unit="pedidos" tone="amber" active={cardFilter === 'HOJE'} onClick={() => toggleCard('HOJE')} />
        <AttentionCard label="Falta produzir" value={shortfallItemsCount} unit="itens" tone="violet" active={cardFilter === 'FALTA_PRODUZIR'} onClick={() => toggleCard('FALTA_PRODUZIR')} />
        <AttentionCard label="Prontos para entregar" value={readyRows.length} unit="pedidos" tone="sky" active={cardFilter === 'PRONTOS'} onClick={() => toggleCard('PRONTOS')} />
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => setFormOpen(true)} className="tk-btn-primary">
          + Novo pedido
        </button>
      </div>
      <OrderForm open={formOpen} onOpenChange={setFormOpen} products={products} partners={partners} recentBuyers={recentBuyers} />
      <OrderForm
        open={addItemOpen}
        onOpenChange={setAddItemOpen}
        products={products}
        partners={partners}
        recentBuyers={recentBuyers}
        existingOrder={selected ? { id: selected.id, orderNumber: selected.orderNumber } : undefined}
      />

      <div className="mt-6 space-y-6">
        {renderSection('Atrasados', groups.atrasados)}
        {renderSection('Para entregar hoje', groups.hoje)}
        {renderSection('Próximos', groups.proximos)}

        {totalVisible === 0 && (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
            Nenhum pedido encontrado com esse filtro.
          </div>
        )}

        {groups.finalized.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowDelivered((v) => !v)} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
              {showDelivered ? 'Ocultar entregues' : `Mostrar entregues (${groups.finalized.length})`}
            </button>
            {showDelivered && <div className="mt-2">{renderSection('Entregues', groups.finalized)}</div>}
          </div>
        )}
      </div>

      <OrderDetailDrawer
        order={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onAddItem={() => setAddItemOpen(true)}
      />

      {toast && (
        <UndoToast message={toast.label} onUndo={undoDeliverAll} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
