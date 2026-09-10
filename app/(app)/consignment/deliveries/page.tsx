import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { DeliveryForm } from './DeliveryForm'
import { deleteConsignmentDelivery } from '@/actions/consignmentDeliveries'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { resolveDateRange } from '@/lib/dateRange'

export const dynamic = 'force-dynamic'

export default async function ConsignmentDeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; from?: string; to?: string }>
}) {
  const { productId, from, to } = await searchParams
  const range = resolveDateRange({ from, to })
  const [deliveries, partners, products] = await Promise.all([
    prisma.consignmentDelivery.findMany({
      where: { deliveryDate: { gte: range.gte, lte: range.lte } },
      orderBy: { deliveryDate: 'desc' },
      include: { partner: true, product: true, saleReports: true },
    }),
    prisma.consignmentPartner.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Entregas em consignação</h1>
      <DeliveryForm partners={partners} products={products} defaultProductId={productId} />
      <DateRangeFilter action="/consignment/deliveries" from={range.from} to={range.to} />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Data</th>
            <th>Parceiro</th>
            <th>Produto</th>
            <th>Entregue</th>
            <th>Vendido</th>
            <th>Saldo restante</th>
            <th>Preço unit.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => {
            const sold = d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
            // Nunca negativo -- ver comentário em lib/reports.ts#getOwnStockSummary.
            const remaining = Math.max(0, d.quantityDelivered - sold)
            return (
              <tr key={d.id} className="tk-row">
                <td className="py-2">{d.deliveryDate.toLocaleDateString('pt-BR')}</td>
                <td>{d.partner.name}</td>
                <td>{d.product.name}</td>
                <td>{d.quantityDelivered}</td>
                <td>{sold}</td>
                <td>{remaining}</td>
                <td>{formatCurrency(d.unitPrice.toNumber())}</td>
                <td>
                  <ConfirmDeleteForm action={async () => { 'use server'; return await deleteConsignmentDelivery(d.id) }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
