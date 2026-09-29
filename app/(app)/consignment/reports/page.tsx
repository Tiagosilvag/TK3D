import { prisma } from '@/lib/prisma'
import { SaleReportForm } from './SaleReportForm'
import { EditableSaleReportRow, type SaleReportRowData } from './EditableSaleReportRow'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { resolveDateRange } from '@/lib/dateRange'

export const dynamic = 'force-dynamic'

export default async function ConsignmentSaleReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { from, to } = await searchParams
  const range = resolveDateRange({ from, to })

  const [reports, deliveries] = await Promise.all([
    prisma.consignmentSaleReport.findMany({
      where: { reportDate: { gte: range.gte, lte: range.lte } },
      orderBy: { reportDate: 'desc' },
      include: { delivery: { include: { partner: true, product: true, saleReports: true } } },
    }),
    prisma.consignmentDelivery.findMany({
      include: { partner: true, product: true, saleReports: true },
      orderBy: { deliveryDate: 'desc' },
    }),
  ])

  const rows: SaleReportRowData[] = reports.map((r) => {
    const alreadySoldExcludingSelf = r.delivery.saleReports.filter((x) => x.id !== r.id).reduce((sum, x) => sum + x.quantitySold, 0)
    return {
      id: r.id,
      deliveryId: r.deliveryId,
      reportDate: r.reportDate.toISOString(),
      partnerName: r.delivery.partner.name,
      productName: r.delivery.product.name,
      quantitySold: r.quantitySold,
      commissionPercent: r.commissionPercent.toNumber(),
      unitPrice: r.unitPrice?.toNumber() ?? r.delivery.unitPrice.toNumber(),
      maxQuantity: r.delivery.quantityDelivered - alreadySoldExcludingSelf,
    }
  })

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
        unitPrice: d.unitPrice.toNumber(),
      }
    })
    .filter((d) => d.remaining > 0)

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Relatórios de venda (consignação)</h1>
      <SaleReportForm deliveries={deliveryOptions} />
      <DateRangeFilter action="/consignment/reports" from={range.from} to={range.to} />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Data</th>
            <th>Parceiro</th>
            <th>Produto</th>
            <th className="text-center">Qtd. vendida</th>
            <th className="text-center">Preço unit.</th>
            <th className="text-center">Comissão</th>
            <th className="text-center">Repasse</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <EditableSaleReportRow key={row.id} report={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
