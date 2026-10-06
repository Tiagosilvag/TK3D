'use client'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { formatCurrency, getOrderStatusBadge, getDeadlineBadge, ORDER_CHANNEL_LABELS } from '@/lib/format'
import { todayInBrasilia } from '@/lib/timezone'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { OrderForm, type OrderProductOption } from './OrderForm'
import { OrderStatusForm } from './OrderStatusForm'
import { deleteOrder, cancelOrder, updateOrderItem, removeOrderItem } from '@/actions/orders'
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
  reallocationsLost: OrderReallocationTag[]
}

export interface OrderRow {
  id: string
  orderNumber: string | null
  orderDate: string
  deliveryDate: string
  channel: OrderChannel
  buyerOrPlatform: string | null
  notes: string | null
  items: OrderItemRow[]
}

const TERMINAL: OrderStatus[] = ['ENTREGUE', 'CANCELADO']
// Do pior pro melhor -- usado pra achar o status "mais atrasado" entre os
// itens ainda ativos de um pedido, pra decidir o badge agregado da linha.
const STATUS_PRIORITY: OrderStatus[] = ['RECEBIDO', 'EM_PRODUCAO', 'PRONTO', 'DESPACHADO', 'AGUARDANDO_PRODUCAO', 'PARCIAL_AGUARDANDO_PRODUCAO', 'AGUARDANDO_MONTAGEM', 'PRONTO_RESERVADO']

// Melhoria "Pedidos com múltiplos itens": um pedido agora é um cabeçalho
// com N itens, cada um com seu próprio status -- o status "do pedido"
// mostrado na tabela principal é derivado (o pior status entre os itens
// ainda ativos; CANCELADO só se TODOS os itens estiverem cancelados;
// ENTREGUE só quando TODOS os itens não-cancelados já viraram venda),
// nunca um campo próprio. Clicar na linha abre o detalhe por item (mesmo
// padrão de modal-por-clique de PartnerStockSection.tsx).
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

function chipClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

// Mesmo critério de getDeadlineBadge (lib/format.ts) -- "hoje" em
// Brasília, nunca o fuso da máquina rodando o navegador.
function daysUntil(dateStr: string): number {
  const msPerDay = 1000 * 60 * 60 * 24
  const today = todayInBrasilia()
  const delivery = new Date(dateStr)
  delivery.setUTCHours(0, 0, 0, 0)
  return Math.round((delivery.getTime() - today.getTime()) / msPerDay)
}

// Pedido do usuário "editar depois de adicionado": quantidade/valor de um
// item já salvo viram editáveis inline (clicar "Editar" troca o texto por
// 2 inputs + Salvar/Cancelar); "Remover" tira o item do pedido de vez.
// Só aparece quando o item ainda não virou venda (saleId null) -- depois
// disso é histórico de venda de verdade, só editável em Vendas.
function OrderItemCard({ item }: { item: OrderItemRow }) {
  const [editing, setEditing] = useState(false)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice))
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const itemBadge = getOrderStatusBadge(item.status)
  const canEdit = !item.saleId

  function startEdit() {
    setQuantity(String(item.quantity))
    setUnitPrice(String(item.unitPrice))
    setError(null)
    setEditing(true)
  }

  function saveEdit() {
    const qty = parseInt(quantity, 10)
    const price = parseFloat(unitPrice)
    if (!Number.isFinite(qty) || qty <= 0) return setError('Quantidade inválida')
    if (!Number.isFinite(price) || price <= 0) return setError('Valor inválido')
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('quantity', String(qty))
      fd.set('unitPrice', String(price))
      const result = await updateOrderItem(item.id, fd)
      if (!result.success) return setError(result.error ?? 'Erro ao salvar.')
      setEditing(false)
    })
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            title={`itemId=${item.id} colorComboKey=${item.colorComboKey ?? ''}`}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100"
          >
            {item.colorHex && <span style={{ background: item.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
            {item.productName}{item.colorLabel && <span className="font-normal text-slate-500 dark:text-slate-400"> — {item.colorLabel}</span>}
          </div>
          {editing ? (
            <div className="mt-1 flex items-center gap-2">
              <input type="number" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="tk-input w-16 px-1.5 py-0.5 text-xs" />
              <span className="text-xs text-slate-400">un ×</span>
              <input type="number" step="0.01" min="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="tk-input w-24 px-1.5 py-0.5 text-xs" />
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {item.quantity}un × {formatCurrency(item.unitPrice)}
              {item.reservedQuantity > 0 && item.reservedQuantity < item.quantity && ` · ${item.reservedQuantity} de ${item.quantity} reservado`}
            </p>
          )}
          {error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
          {item.reallocationsLost.map((r, i) => (
            <p key={i} className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
              ⚠ {r.quantity} peça{r.quantity === 1 ? '' : 's'} realocada{r.quantity === 1 ? '' : 's'} pro pedido {r.toOrderNumber ? `#${r.toOrderNumber}` : '(sem número)'} em {new Date(r.createdAt).toLocaleDateString('pt-BR')}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge badge={itemBadge} />
          <OrderStatusForm orderItemId={item.id} status={item.status} />
          {canEdit && (
            editing ? (
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={saveEdit} disabled={isPending} className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                  {isPending ? 'Salvando…' : 'Salvar'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="text-slate-400 hover:underline">Cancelar</button>
              </div>
            ) : (
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={startEdit} className="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400">Editar</button>
                <ConfirmDeleteForm
                  action={async () => await removeOrderItem(item.id)}
                  label="Remover"
                  confirmMessage="Remover este item do pedido? A peça reservada volta pro estoque disponível."
                  className="text-red-600 hover:underline dark:text-red-400"
                />
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

type Tab = 'TODOS' | 'ATRASADOS' | 'PROXIMOS' | 'ENTREGUES'

// Melhoria "Pedidos com reserva de estoque" §5 + "Pedidos com múltiplos
// itens": cards de KPI, abas de filtro e tabela ordenada por prazo mais
// próximo -- mesmo padrão visual de chip/aba já usado em
// FilamentsExplorer.tsx (chipClass) e cards de resumo já usados em
// sales/page.tsx. Cada linha é um PEDIDO (cabeçalho); clicar abre o
// detalhe por item num modal.
export function OrdersExplorer({ rows, products }: { rows: OrderRow[]; products: OrderProductOption[] }) {
  const [tab, setTab] = useState<Tab>('TODOS')
  const [formOpen, setFormOpen] = useState(false)
  // Pedido do usuário "editar pedido pra adicionar peça": 2ª instância do
  // mesmo OrderForm, em modo existingOrder (sem campos de cabeçalho) --
  // aberta pelo botão "+ Adicionar item" dentro do modal de detalhe.
  const [addItemOpen, setAddItemOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<OrderRow | null>(null)

  function openDetail(row: OrderRow) {
    setSelected(row)
    dialogRef.current?.showModal()
  }

  // Bug fix (mesmo de PartnerStockSection.tsx): `selected` é um snapshot
  // tirado em openDetail(). router.refresh() (disparado por
  // OrderStatusForm/cancelOrder) atualiza `rows`, mas `selected` nunca
  // era re-sincronizado sozinho -- marcar item entregue parecia não ter
  // feito nada até fechar e reabrir o modal.
  useEffect(() => {
    setSelected((prev) => (prev ? (rows.find((r) => r.id === prev.id) ?? null) : prev))
  }, [rows])

  useEffect(() => {
    if (selected === null && dialogRef.current?.open) dialogRef.current.close()
  }, [selected])

  const rowsWithStatus = useMemo(() => rows.map((r) => ({ row: r, status: aggregateStatus(r.items) })), [rows])

  const openRows = useMemo(() => rowsWithStatus.filter((r) => !TERMINAL.includes(r.status)), [rowsWithStatus])
  const lateCount = useMemo(() => openRows.filter((r) => daysUntil(r.row.deliveryDate) < 0).length, [openRows])
  const soonCount = useMemo(() => openRows.filter((r) => { const d = daysUntil(r.row.deliveryDate); return d >= 0 && d <= 3 }).length, [openRows])
  const openValue = useMemo(
    () => rows.reduce((sum, r) => sum + r.items.filter((i) => !TERMINAL.includes(i.status)).reduce((s, i) => s + i.quantity * i.unitPrice, 0), 0),
    [rows],
  )
  const deliveredCount = useMemo(() => rowsWithStatus.filter((r) => r.status === 'ENTREGUE').length, [rowsWithStatus])

  const visibleRows = useMemo(() => {
    const filtered = rowsWithStatus.filter(({ row, status }) => {
      if (tab === 'ATRASADOS') return !TERMINAL.includes(status) && daysUntil(row.deliveryDate) < 0
      if (tab === 'PROXIMOS') { const d = daysUntil(row.deliveryDate); return !TERMINAL.includes(status) && d >= 0 && d <= 3 }
      if (tab === 'ENTREGUES') return status === 'ENTREGUE'
      return true
    })
    return [...filtered].sort((a, b) => new Date(a.row.deliveryDate).getTime() - new Date(b.row.deliveryDate).getTime())
  }, [rowsWithStatus, tab])

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Pedidos em aberto</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{openRows.length}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Atrasados</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${lateCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>{lateCount}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Entregam em até 3 dias</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${soonCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>{soonCount}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Valor em aberto</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(openValue)}</p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => setFormOpen(true)} className="tk-btn-primary">
          + Novo pedido
        </button>
      </div>
      <OrderForm open={formOpen} onOpenChange={setFormOpen} products={products} />
      <OrderForm
        open={addItemOpen}
        onOpenChange={setAddItemOpen}
        products={products}
        existingOrder={selected ? { id: selected.id, orderNumber: selected.orderNumber } : undefined}
      />

      <div className="mb-3 mt-6 flex flex-wrap gap-2">
        <button type="button" onClick={() => setTab('TODOS')} className={chipClass(tab === 'TODOS')}>Todos {rows.length}</button>
        <button type="button" onClick={() => setTab('ATRASADOS')} className={chipClass(tab === 'ATRASADOS')}>Atrasados {lateCount}</button>
        <button type="button" onClick={() => setTab('PROXIMOS')} className={chipClass(tab === 'PROXIMOS')}>Próximos 3 dias {soonCount}</button>
        <button type="button" onClick={() => setTab('ENTREGUES')} className={chipClass(tab === 'ENTREGUES')}>Entregues {deliveredCount}</button>
      </div>

      <table className="tk-table-zebra w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Data pedido</th>
            <th>Entrega</th>
            <th>Canal</th>
            <th>Comprador</th>
            <th>Itens</th>
            <th className="text-center">Valor total</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ row, status }) => {
            const badge = getOrderStatusBadge(status)
            const deadline = getDeadlineBadge(new Date(row.deliveryDate), status)
            const total = row.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
            const anySale = row.items.some((i) => i.saleId)
            return (
              <tr key={row.id} onClick={() => openDetail(row)} className="tk-row cursor-pointer align-top hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <td className="py-2">{new Date(row.orderDate).toLocaleDateString('pt-BR')}</td>
                <td>
                  <div>{new Date(row.deliveryDate).toLocaleDateString('pt-BR')}</div>
                  {!TERMINAL.includes(status) && (
                    <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${deadline.className}`}>{deadline.label}</span>
                  )}
                </td>
                <td>{ORDER_CHANNEL_LABELS[row.channel]}</td>
                <td className="text-slate-500 dark:text-slate-400">{row.buyerOrPlatform ?? '—'}</td>
                <td>
                  {row.items.length} item{row.items.length === 1 ? '' : 'ns'}
                  {row.orderNumber && <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">#{row.orderNumber}</span>}
                </td>
                <td className="text-center">{formatCurrency(total)}</td>
                <td>
                  <StatusBadge badge={badge} />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col items-start gap-1">
                    {!anySale && !TERMINAL.includes(status) && (
                      <ConfirmDeleteForm
                        action={async () => await cancelOrder(row.id)}
                        label="Cancelar"
                        confirmMessage="Cancelar os itens pendentes deste pedido? A peça reservada volta pro estoque disponível."
                        className="text-xs text-amber-600 hover:underline dark:text-amber-400"
                      />
                    )}
                    {!anySale && (
                      <ConfirmDeleteForm
                        action={async () => await deleteOrder(row.id)}
                        label="Excluir"
                        className="text-xs text-red-600 hover:underline dark:text-red-400"
                      />
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {visibleRows.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum pedido encontrado com esse filtro.
        </div>
      )}

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        className="w-full [--tk-dialog-cap:36rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        {selected && (
          <div className="grid grid-cols-1 gap-3 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold">
                  Pedido {selected.orderNumber ? `#${selected.orderNumber}` : ''} {selected.buyerOrPlatform && <span className="font-normal text-slate-500 dark:text-slate-400">— {selected.buyerOrPlatform}</span>}
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {ORDER_CHANNEL_LABELS[selected.channel]} · Entrega em {new Date(selected.deliveryDate).toLocaleDateString('pt-BR')}
                  {selected.notes && ` · ${selected.notes}`}
                </p>
              </div>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
            </div>

            <button
              type="button"
              onClick={() => setAddItemOpen(true)}
              className="rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60"
            >
              + Adicionar item a este pedido
            </button>

            <div className="space-y-2">
              {selected.items.map((item) => (
                <OrderItemCard key={item.id} item={item} />
              ))}
            </div>

            <div className="mt-1 flex justify-end">
              <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
                Fechar
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  )
}
