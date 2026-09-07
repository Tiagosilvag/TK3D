import { prisma } from '@/lib/prisma'
import { PartnerForm } from './PartnerForm'
import { deleteConsignmentPartner } from '@/actions/consignmentPartners'

export const dynamic = 'force-dynamic'

export default async function ConsignmentPartnersPage() {
  const partners = await prisma.consignmentPartner.findMany({ where: { active: true }, orderBy: { name: 'asc' } })

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Parceiros de consignação</h1>
      <PartnerForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Nome</th>
            <th>Comissão padrão</th>
            <th>Observações</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="py-2">{p.name}</td>
              <td>{(p.defaultCommissionPercent.toNumber() * 100).toFixed(0)}%</td>
              <td>{p.notes ?? '-'}</td>
              <td>
                <form action={async () => { 'use server'; await deleteConsignmentPartner(p.id) }}>
                  <button className="text-red-600 hover:underline">Remover</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
