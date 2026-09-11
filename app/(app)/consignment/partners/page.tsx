import { prisma } from '@/lib/prisma'
import { getConsignmentPartnerSummary } from '@/lib/reports'
import { PartnersExplorer, type PartnerCardRow } from './PartnersExplorer'

export const dynamic = 'force-dynamic'

export default async function ConsignmentPartnersPage() {
  const [partners, listSummary] = await Promise.all([
    prisma.consignmentPartner.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getConsignmentPartnerSummary(),
  ])
  const itemsByPartnerId = new Map(listSummary.map((s) => [s.partnerId, s.itemsWithPartner]))

  const rows: PartnerCardRow[] = partners.map((p) => ({
    id: p.id,
    name: p.name,
    defaultCommissionPercent: p.defaultCommissionPercent.toNumber(),
    itemsWithPartner: itemsByPartnerId.get(p.id) ?? 0,
  }))

  const avgCommissionPercent = rows.length > 0 ? rows.reduce((sum, r) => sum + r.defaultCommissionPercent, 0) / rows.length : 0

  return (
    <div className="tk-page">
      <PartnersExplorer partners={rows} avgCommissionPercent={avgCommissionPercent} />
    </div>
  )
}
