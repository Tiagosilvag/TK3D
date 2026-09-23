'use client'
import { useMemo, useState } from 'react'
import { formatCurrency, getOrderStatusBadge, getDeadlineBadge, ORDER_CHANNEL_LABELS } from '@/lib/format'
import { todayInBrasilia } from '@/lib/timezone'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { OrderForm, type OrderProductOption } from './OrderForm'
import { OrderStatusForm } from './OrderStatusForm'
import { deleteOrder, cancelOrder } from '@/actions/orders'
import type { OrderChannel, OrderStatus } from '@prisma/client'

export interface OrderReallocationTag {
  quantity: number
  toOrderNumber: string | null
  createdAt: string
}

export interface OrderRow {
  id: string
  orderDate: string
  deliveryDate: string
  channel: OrderChannel
  productName: string
  colorLabel: string | null
  colorHex: string | null
  quantity: number
  reservedQuantity: number
  unitPrice: number
  buyerOrPlatform: string | null
  orderNumber: string | null
  status: OrderStatus
  saleId: string | null
  reallocationsLost: OrderReallocationTag[]
}

const TERMINAL: OrderStatus[] = ['ENTREGUE', 'CANCELADO']

type Tab = 'TODOS' | 'ATRASADOS' | 'PROXIMOS' | 'ENTREGUES'

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

// Melhoria "Pedidos com reserva de estoque" §5: cards de KPI, abas de
// filtro e tabela ordenada por prazo mais próximo -- mesmo padrão visual
// de chip/aba já usado em FilamentsExplorer.tsx (chipClass) e cards de
// resumo já usados em sales/page.tsx.
export function OrdersExplorer({ rows, products }: { rows: OrderRow[]; products: OrderProductOption[] }) {
  const [tab, setTab] = useState<Tab>('TODOS')

  const openRows = useMemo(() => rows.filter((r) => !TERMINAL.includes(r.status)), [rows])
  const lateCount = useMemo(() => openRows.filter((r) => daysUntil(r.deliveryDate) < 0).length, [openRows])
  const soonCount = useMemo(() => openRows.filter((r) => { const d = daysUntil(r.deliveryDate); return d >= 0 && d <= 3 }).length, [openRows])
  const openValue = useMemo(() => openRows.reduce((sum, r) => sum + r.quantity * r.unitPrice, 0), [openRows])
  const deliveredCount = useMemo(() => rows.filter((r) => r.status === 'ENTREGUE').length, [rows])

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (tab === 'ATRASADOS') return !TERMINAL.includes(r.status) && daysUntil(r.deliveryDate) < 0
      if (tab === 'PROXIMOS') { const d = daysUntil(r.deliveryDate); return !TERMINAL.includes(r.status) && d >= 0 && d <= 3 }
      if (tab === 'ENTREGUES') return r.status === 'ENTREGUE'
      return true
    })
    return [...filtered].sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime())
  }, [rows, tab])

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

      <div className="mt-4">
        <OrderForm products={products} />
      </div>

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
            <th>Produto</th>
            <th>Comprador</th>
            <th className="text-center">Qtd.</th>
            <th className="text-center">Valor unit.</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((o) => {
            const badge = getOrderStatusBadge(o.status)
            const deadline = getDeadlineBadge(new Date(o.deliveryDate), o.status)
            return (
              <tr key={o.id} className="tk-row align-top">
                <td className="py-2">{new Date(o.orderDate).toLocaleDateString('pt-BR')}</td>
                <td>
                  <div>{new Date(o.deliveryDate).toLocaleDateString('pt-BR')}</div>
                  {!TERMINAL.includes(o.status) && (
                    <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${deadline.className}`}>{deadline.label}</span>
                  )}
                </td>
                <td>{ORDER_CHANNEL_LABELS[o.channel]}</td>
                <td>
                  <div className="flex items-center gap-2">
                    {o.colorHex && <span style={{ background: o.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                    <span>{o.productName}{o.colorLabel && <span className="text-slate-500 dark:text-slate-400"> — {o.colorLabel}</span>}</span>
                  </div>
                  {o.reservedQuantity > 0 && o.reservedQuantity < o.quantity && (
                    <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{o.reservedQuantity} de {o.quantity} reservado</div>
                  )}
                  {/* Melhoria "Pedidos com reserva de estoque" §4: etiqueta
                      PERMANENTE (nunca some sozinha, diferente do aviso
                      passageiro do formulário) -- aparece em qualquer lugar
                      que listar este pedido. */}
                  {o.reallocationsLost.map((r, i) => (
                    <div key={i} className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                      ⚠ {r.quantity} peça{r.quantity === 1 ? '' : 's'} realocada{r.quantity === 1 ? '' : 's'} para o pedido {r.toOrderNumber ? `#${r.toOrderNumber}` : '(sem número)'} (prazo mais urgente) em {new Date(r.createdAt).toLocaleDateString('pt-BR')}
                    </div>
                  ))}
                </td>
                <td className="text-slate-500 dark:text-slate-400">{o.buyerOrPlatform ?? '—'}</td>
                <td className="text-center">{o.quantity}</td>
                <td className="text-center">{formatCurrency(o.unitPrice)}</td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge badge={badge} />
                    <OrderStatusForm orderId={o.id} status={o.status} />
                  </div>
                </td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    {!o.saleId && !TERMINAL.includes(o.status) && (
                      <ConfirmDeleteForm
                        action={async () => await cancelOrder(o.id)}
                        label="Cancelar"
                        confirmMessage="Cancelar este pedido? A peça reservada volta pro estoque disponível."
                        className="text-xs text-amber-600 hover:underline dark:text-amber-400"
                      />
                    )}
                    {!o.saleId && (
                      <ConfirmDeleteForm
                        action={async () => await deleteOrder(o.id)}
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
    </div>
  )
}
