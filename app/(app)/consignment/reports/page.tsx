import { prisma } from '@/lib/prisma'
import { SaleReportForm } from './SaleReportForm'
import { deleteConsignmentSaleReport } from '@/actions/consignmentSaleReports'

export const dynamic = 'force-dynamic'

export default async function ConsignmentSaleReportsPage() {
  const [reports, deliveries] = await Promise.all([
    prisma.consignmentSaleReport.findMany({
      orderBy: { reportDate: 'desc' },
      include: { delivery: { include: { partner: true, product: true } } },
    }),
    prisma.consignmentDelivery.findMany({
      include: { partner: true, product: true, saleReports: true },
      orderBy: { deliveryDate: 'desc' },
    }),
  ])

  // Only deliveries with remaining stock make sense as a target for a new
  // sale report (getPartnerStock's remaining math, applied per delivery).
  const deliveryOptions = deliveries
    .map((d) => {
      const sold = d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
      return {
        id: d.id,
        partnerName: d.partner.name,
        productName: d.product.name,
        remaining: d.quantityDelivered - sold,
        defaultCommissionPercent: d.partner.defaultCommissionPercent.toNumber(),
      }
    })
    .filter((d) => d.remaining > 0)

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Relatórios de venda (consignação)</h1>
      <SaleReportForm deliveries={deliveryOptions} />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Data</th>
            <th>Parceiro</th>
            <th>Produto</th>
            <th>Qtd. vendida</th>
            <th>Comissão</th>
            <th>Repasse</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => {
            const unitPrice = r.delivery.unitPrice.toNumber()
            const commission = r.commissionPercent.toNumber()
            const gross = r.quantitySold * unitPrice
            const payout = gross * (1 - commission)
            return (
              <tr key={r.id} className="border-b">
                <td className="py-2">{r.reportDate.toLocaleDateString('pt-BR')}</td>
                <td>{r.delivery.partner.name}</td>
                <td>{r.delivery.product.name}</td>
                <td>{r.quantitySold}</td>
                <td>{(commission * 100).toFixed(0)}%</td>
                <td>R$ {payout.toFixed(2)}</td>
                <td>
                  <form action={async () => { 'use server'; await deleteConsignmentSaleReport(r.id) }}>
                    <button className="text-red-600 hover:underline">Remover</button>
                  </form>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
