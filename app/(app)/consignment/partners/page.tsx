import { prisma } from '@/lib/prisma'
import { PartnerForm } from './PartnerForm'
import { deleteConsignmentPartner } from '@/actions/consignmentPartners'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function ConsignmentPartnersPage() {
  const partners = await prisma.consignmentPartner.findMany({ where: { active: true }, orderBy: { name: 'asc' } })

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Parceiros de consignação</h1>
      <PartnerForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Nome</th>
            <th>Comissão padrão</th>
            <th>Observações</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} className="tk-row">
              <td className="py-2">{p.name}</td>
              <td>{(p.defaultCommissionPercent.toNumber() * 100).toFixed(0)}%</td>
              <td>{p.notes ?? '-'}</td>
              <td>
                <ConfirmDeleteForm action={async () => { 'use server'; await deleteConsignmentPartner(p.id) }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
