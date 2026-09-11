import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getConsignmentPartnerDetail } from '@/lib/reports'
import { formatCurrency } from '@/lib/format'
import { PartnerDetailHeader } from './PartnerDetailHeader'
import { PartnerStockSection } from './PartnerStockSection'

export const dynamic = 'force-dynamic'

const HISTORY_TYPE_LABELS = { entrega: 'Entrega', venda: 'Venda' } as const

export default async function ConsignmentPartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getConsignmentPartnerDetail(id)
  if (!detail) notFound()

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

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Itens com ela</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{detail.itemsWithPartner}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total já vendido</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{detail.totalSold} un</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Comissão a pagar</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(detail.commissionOwed)}</p>
        </div>
      </div>

      <div className="mt-6">
        <PartnerStockSection products={detail.products} />
      </div>

      <div className="mt-6 tk-panel p-4">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Histórico</h2>
        {detail.history.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Nenhum evento registrado ainda.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Data</th>
                <th>Tipo</th>
                <th>Produto</th>
                <th>Cor</th>
                <th>Qtd.</th>
              </tr>
            </thead>
            <tbody>
              {detail.history.map((event, i) => (
                <tr key={i} className="tk-row">
                  <td className="py-2">{event.date.toLocaleDateString('pt-BR')}</td>
                  <td>{HISTORY_TYPE_LABELS[event.type]}</td>
                  <td>{event.productName}</td>
                  <td className="text-slate-500 dark:text-slate-400">{event.colorLabel ?? '—'}</td>
                  <td>{event.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
