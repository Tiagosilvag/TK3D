import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { SaleForm } from './SaleForm'
import { deleteSale, getSaleProfit } from '@/actions/sales'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import type { SaleChannel } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CHANNEL_LABELS: Record<SaleChannel, string> = {
  DIRETA: 'Direta',
  MARKETPLACE: 'Marketplace',
}

const CHANNEL_FILTERS: { value: SaleChannel | undefined; label: string }[] = [
  { value: undefined, label: 'Todas' },
  { value: 'DIRETA', label: 'Direta' },
  { value: 'MARKETPLACE', label: 'Marketplace' },
]

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>
}) {
  const { channel } = await searchParams
  const activeChannel = channel === 'DIRETA' || channel === 'MARKETPLACE' ? channel : undefined

  const [sales, products] = await Promise.all([
    prisma.sale.findMany({
      where: activeChannel ? { channel: activeChannel } : undefined,
      orderBy: { saleDate: 'desc' },
      include: { product: true },
    }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ])

  const profits = await Promise.all(sales.map((s) => getSaleProfit(s.id)))

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Vendas</h1>
      <SaleForm products={products} />

      <div className="mb-3 mt-6 flex gap-1">
        {CHANNEL_FILTERS.map((f) => {
          const href = f.value ? `/sales?channel=${f.value}` : '/sales'
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
            <th>Canal</th>
            <th>Produto</th>
            <th>Qtd.</th>
            <th>Valor unit.</th>
            <th>Comprador/Plataforma</th>
            <th>Lucro</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s, i) => {
            const profit = profits[i]
            return (
              <tr key={s.id} className="tk-row">
                <td className="py-2">{s.saleDate.toLocaleDateString('pt-BR')}</td>
                <td>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.channel === 'DIRETA'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {CHANNEL_LABELS[s.channel]}
                  </span>
                </td>
                <td>{s.product.name}</td>
                <td>{s.quantity}</td>
                <td>{formatCurrency(s.unitPrice.toNumber())}</td>
                <td className="text-slate-500 dark:text-slate-400">{s.buyerOrPlatform ?? '-'}</td>
                <td className={profit >= 0 ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>
                  {formatCurrency(profit)}
                </td>
                <td>
                  <ConfirmDeleteForm action={async () => { 'use server'; await deleteSale(s.id) }} />
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
