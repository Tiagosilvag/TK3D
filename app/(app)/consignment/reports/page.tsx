import { prisma } from '@/lib/prisma'
import { getConsignmentSaleReportRows } from '@/lib/reports'
import { ReportsExplorer, type ReportRow } from './ReportsExplorer'
import type { DeliveryOption } from './SaleReportForm'

export const dynamic = 'force-dynamic'

// Redesign "Relatórios de venda" (consignação): página inteira passa a ser
// client-side (busca/filtros/agrupamento instantâneos, sem round-trip ao
// servidor) -- então carrega TUDO de uma vez aqui (sem filtro de
// De/Até server-side, que virou o seletor de período já dentro da tela),
// mesmo padrão de DeliveryBatchForm.tsx em Entregas (catálogo pequeno).
export default async function ConsignmentSaleReportsPage() {
  const [rows, deliveries] = await Promise.all([
    getConsignmentSaleReportRows(),
    prisma.consignmentDelivery.findMany({
      include: { partner: true, product: true, saleReports: true },
      orderBy: { deliveryDate: 'desc' },
    }),
  ])

  const reportRows: ReportRow[] = rows

  // Only deliveries with remaining stock make sense as a target for a new
  // sale report (getPartnerStock's remaining math, applied per delivery).
  const deliveryOptions: DeliveryOption[] = deliveries
    .map((d) => {
      const sold = d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
      return {
        id: d.id,
        partnerName: d.partner.name,
        productName: d.product.name,
        remaining: d.quantityDelivered - sold - d.returnedQuantity,
        defaultCommissionPercent: d.partner.defaultCommissionPercent.toNumber(),
        unitPrice: d.unitPrice.toNumber(),
      }
    })
    .filter((d) => d.remaining > 0)

  return (
    <div className="tk-page">
      <ReportsExplorer rows={reportRows} deliveries={deliveryOptions} />
    </div>
  )
}
