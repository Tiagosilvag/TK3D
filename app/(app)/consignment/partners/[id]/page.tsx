import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getConsignmentPartnerDetail } from '@/lib/reports'
import { PartnerDetailHeader } from './PartnerDetailHeader'
import { PartnerFinancialSummary } from './PartnerFinancialSummary'
import { PartnerStockSection } from './PartnerStockSection'
import { PartnerHistorySection } from './PartnerHistorySection'

export const dynamic = 'force-dynamic'

export default async function ConsignmentPartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getConsignmentPartnerDetail(id)
  if (!detail) notFound()

  const productsWithStock = detail.products.filter((p) => p.remaining > 0).length

  return (
    <div className="tk-page">
      <Link href="/consignment/partners" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        &larr; Parceiros de consignação
      </Link>

      <div className="mt-2">
        <PartnerDetailHeader
          partner={{
            id: detail.partnerId,
            name: detail.partnerName,
            defaultCommissionPercent: detail.defaultCommissionPercent,
            notes: detail.notes,
          }}
        />
      </div>

      <div className="mt-6">
        <PartnerFinancialSummary detail={detail} productsWithStock={productsWithStock} />
      </div>

      <div className="mt-6">
        <PartnerStockSection
          products={detail.products}
          saleableDeliveries={detail.saleableDeliveries}
          defaultCommissionPercent={detail.defaultCommissionPercent}
          partnerName={detail.partnerName}
        />
      </div>

      <div className="mt-6">
        <PartnerHistorySection history={detail.history} />
      </div>
    </div>
  )
}
