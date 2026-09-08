import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency, getSaleChannelBadge } from '@/lib/format'
import { SaleForm } from './SaleForm'
import { deleteSale, getSaleProfit } from '@/actions/sales'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { StatusBadge } from '@/components/StatusBadge'
import { resolveDateRange } from '@/lib/dateRange'
import type { SaleChannel } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CHANNEL_FILTERS: { value: SaleChannel | undefined; label: string }[] = [
  { value: undefined, label: 'Todas' },
  { value: 'DIRETA', label: 'Direta' },
  { value: 'SHOPEE', label: 'Shopee' },
  { value: 'MERCADO_LIVRE', label: 'Mercado Livre' },
  { value: 'MARKETPLACE', label: 'Marketplace (antigo)' },
]

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; editId?: string; productId?: string; from?: string; to?: string }>
}) {
  const { channel, editId, productId, from, to } = await searchParams
  const activeChannel = (['DIRETA', 'MARKETPLACE', 'SHOPEE', 'MERCADO_LIVRE'] as const).includes(channel as SaleChannel)
    ? (channel as SaleChannel)
    : undefined
  const range = resolveDateRange({ from, to })

  const [sales, products, editingSaleRecord] = await Promise.all([
    prisma.sale.findMany({
      where: { ...(activeChannel ? { channel: activeChannel } : {}), saleDate: { gte: range.gte, lte: range.lte } },
      orderBy: { saleDate: 'desc' },
      include: { product: true },
    }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    editId ? prisma.sale.findUnique({ where: { id: editId } }) : null,
  ])

  const editingSale = editingSaleRecord
    ? {
        id: editingSaleRecord.id,
        channel: editingSaleRecord.channel,
        productId: editingSaleRecord.productId,
        quantity: editingSaleRecord.quantity,
        unitPrice: editingSaleRecord.unitPrice.toNumber(),
        saleDate: editingSaleRecord.saleDate.toISOString().slice(0, 10),
        buyerOrPlatform: editingSaleRecord.buyerOrPlatform,
        notes: editingSaleRecord.notes,
      }
    : undefined

  // getSaleProfit (task-10 brief, new feature) now returns {profit, estimated}
  // instead of a bare number -- estimated is true only for a legacy sale
  // recorded before Sale.costSnapshot existed, which still falls back to a
  // live recompute (so it CAN drift if Settings/Printer/Filament/Accessory/
  // Supply change later, unlike every snapshot-backed sale). Surfaced below
  // as a small "*" marker rather than a bigger UI change -- every new sale's
  // profit is frozen and displays exactly as before.
  const profits = await Promise.all(sales.map((s) => getSaleProfit(s.id)))

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Vendas</h1>
      <SaleForm key={editingSale?.id ?? 'new'} products={products} editingSale={editingSale} defaultProductId={productId} />

      <DateRangeFilter action="/sales" from={range.from} to={range.to} hiddenParams={{ channel: activeChannel }} />

      <div className="mb-3 mt-6 flex gap-1">
        {CHANNEL_FILTERS.map((f) => {
          const qs = new URLSearchParams()
          if (f.value) qs.set('channel', f.value)
          qs.set('from', range.from)
          qs.set('to', range.to)
          const href = `/sales?${qs.toString()}`
          const isActive = activeChannel === f.value
          return (
            <Link
              key={f.label}
              href={href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              }`}
            >
              {f.label}
            </Link>
          )
        })}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Data</th>
            <th>Plataforma</th>
            <th>Produto</th>
            <th>Qtd.</th>
            <th>Valor unit.</th>
            <th>Comprador</th>
            <th>Custo</th>
            <th>Lucro</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s, i) => {
            const { profit, estimated, saleTotal, costTotal } = profits[i]
            return (
              <tr key={s.id} className="tk-row align-top">
                <td className="py-2">{s.saleDate.toLocaleDateString('pt-BR')}</td>
                <td>
                  <StatusBadge badge={getSaleChannelBadge(s.channel)} />
                </td>
                <td>{s.product.name}</td>
                <td>{s.quantity}</td>
                <td>{formatCurrency(s.unitPrice.toNumber())}</td>
                <td className="text-slate-500 dark:text-slate-400">{s.buyerOrPlatform ?? '-'}</td>
                <td>{formatCurrency(costTotal)}</td>
                <td>
                  <details>
                    <summary
                      className={`cursor-pointer list-none font-medium ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                      title="Ver detalhamento do lucro"
                    >
                      {formatCurrency(profit)}
                      {estimated && (
                        <span title="Venda anterior a este recurso: custo estimado retroativamente, pode variar se preços mudarem" className="ml-1 text-slate-400 dark:text-slate-500">*</span>
                      )}
                    </summary>
                    <dl className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex justify-between gap-3">
                        <dt>Valor da venda</dt>
                        <dd>{formatCurrency(saleTotal)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>Custo de produção</dt>
                        <dd>− {formatCurrency(costTotal)}</dd>
                      </div>
                      <div className="flex justify-between gap-3 font-medium text-slate-700 dark:text-slate-200">
                        <dt>Lucro</dt>
                        <dd>{formatCurrency(profit)}</dd>
                      </div>
                    </dl>
                  </details>
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <Link href={`/sales?editId=${s.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Editar
                    </Link>
                    <ConfirmDeleteForm action={async () => { 'use server'; await deleteSale(s.id) }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {sales.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma venda registrada{activeChannel ? ' neste canal' : ''}.
        </div>
      )}
    </div>
  )
}
