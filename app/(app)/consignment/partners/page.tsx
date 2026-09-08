import { prisma } from '@/lib/prisma'
import { PartnerForm } from './PartnerForm'
import { deleteConsignmentPartner } from '@/actions/consignmentPartners'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { getConsignmentPartnerSummary } from '@/lib/reports'

export const dynamic = 'force-dynamic'

export default async function ConsignmentPartnersPage() {
  const [partners, summaries] = await Promise.all([
    prisma.consignmentPartner.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getConsignmentPartnerSummary(),
  ])
  const summaryByPartnerId = new Map(summaries.map((s) => [s.partnerId, s]))

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
          {partners.map((p) => {
            const summary = summaryByPartnerId.get(p.id)
            return (
              <tr key={p.id} className="tk-row align-top">
                <td className="py-2">{p.name}</td>
                <td>{(p.defaultCommissionPercent.toNumber() * 100).toFixed(0)}%</td>
                <td>{p.notes ?? '-'}</td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    {summary && (summary.products.length > 0 || summary.history.length > 0) && (
                      <details>
                        <summary className="tk-summary">Estoque e histórico</summary>
                        {summary.products.length > 0 && (
                          <table className="mt-2 text-xs">
                            <thead>
                              <tr className="tk-table-head-row">
                                <th className="pr-2">Produto</th>
                                <th className="pr-2">Entregue</th>
                                <th className="pr-2">Vendido</th>
                                <th>Com ela</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.products.map((prod) => (
                                <tr key={prod.productName} className="tk-row">
                                  <td className="pr-2">{prod.productName}</td>
                                  <td className="pr-2">{prod.delivered}</td>
                                  <td className="pr-2">{prod.sold}</td>
                                  <td>{prod.remaining}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {summary.history.length > 0 && (
                          <table className="mt-2 text-xs">
                            <thead>
                              <tr className="tk-table-head-row">
                                <th className="pr-2">Data</th>
                                <th className="pr-2">Tipo</th>
                                <th className="pr-2">Produto</th>
                                <th>Qtd.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.history.map((event, i) => (
                                <tr key={i} className="tk-row">
                                  <td className="pr-2">{event.date.toLocaleDateString('pt-BR')}</td>
                                  <td className="pr-2">{event.type === 'entrega' ? 'Entrega' : 'Venda'}</td>
                                  <td className="pr-2">{event.productName}</td>
                                  <td>{event.quantity}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </details>
                    )}
                    <ConfirmDeleteForm action={async () => { 'use server'; await deleteConsignmentPartner(p.id) }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
