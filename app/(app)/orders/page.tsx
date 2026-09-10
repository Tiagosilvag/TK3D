import { prisma } from '@/lib/prisma'
import { formatCurrency, getOrderStatusBadge, ORDER_CHANNEL_LABELS } from '@/lib/format'
import { OrderForm } from './OrderForm'
import { OrderStatusForm } from './OrderStatusForm'
import { deleteOrder } from '@/actions/orders'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { StatusBadge } from '@/components/StatusBadge'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
  const [orders, products] = await Promise.all([
    prisma.order.findMany({ orderBy: { orderDate: 'desc' }, include: { product: true } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Pedidos</h1>
      <OrderForm products={products} />

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Data</th>
            <th>Canal</th>
            <th>Produto</th>
            <th>Qtd.</th>
            <th>Valor unit.</th>
            <th>Nº pedido</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const badge = getOrderStatusBadge(o.status)
            return (
              <tr key={o.id} className="tk-row">
                <td className="py-2">{o.orderDate.toLocaleDateString('pt-BR')}</td>
                <td>{ORDER_CHANNEL_LABELS[o.channel]}</td>
                <td>{o.product.name}</td>
                <td>{o.quantity}</td>
                <td>{formatCurrency(o.unitPrice.toNumber())}</td>
                <td className="text-slate-500 dark:text-slate-400">{o.orderNumber ?? '—'}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <StatusBadge badge={badge} />
                    <OrderStatusForm orderId={o.id} status={o.status} locked={o.status === 'CONCLUIDO'} />
                  </div>
                </td>
                <td>
                  {!o.saleId && (
                    <ConfirmDeleteForm action={async () => { 'use server'; return await deleteOrder(o.id) }} />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {orders.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum pedido registrado ainda.
        </div>
      )}
    </div>
  )
}
