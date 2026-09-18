import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency, getSaleChannelBadge } from '@/lib/format'
import { SaleForm } from './SaleForm'
import { deleteSale, getSaleProfit } from '@/actions/sales'
import { getProductCostBreakdown } from '@/actions/products'
import { getProductVariantStockOptions } from '@/lib/reports'
import type { PlatformFeeTier } from '@/lib/costing'
import { VariantChip } from '@/components/VariantChip'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { StatusBadge } from '@/components/StatusBadge'
import { ActionsMenu } from '@/components/ActionsMenu'
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

  const [sales, productOptions, editingSaleRecord, platformRows] = await Promise.all([
    prisma.sale.findMany({
      where: { ...(activeChannel ? { channel: activeChannel } : {}), saleDate: { gte: range.gte, lte: range.lte } },
      orderBy: { saleDate: 'desc' },
      include: { product: true },
    }),
    // Melhoria "Vendas por variante": cada produto ativo já vem com suas
    // variantes de cor em estoque (getProductVariantStockOptions) -- o
    // formulário só pede a cor quando o produto tem mais de uma.
    getProductVariantStockOptions(),
    editId ? prisma.sale.findUnique({ where: { id: editId } }) : null,
    // Melhoria "Redesign Vendas": taxas cadastradas de cada plataforma,
    // pro painel de referência (4) e pra prévia ao vivo do formulário (3)
    // calcularem a taxa client-side sem round-trip a cada campo mudado --
    // mesmo dado que settings/page.tsx já usa, reaproveitando PlatformFeeTier.
    prisma.marketplacePlatform.findMany({ orderBy: { platform: 'asc' } }),
  ])

  // Melhoria "Redesign Vendas": custo unitário de cada produto, pro bloco
  // "Custo de produção" da prévia ao vivo (3) -- reaproveita
  // getProductCostBreakdown (actions/products.ts), mesmo padrão já usado
  // em products/page.tsx pra listar o custo de todos os produtos de uma
  // vez. O custo não varia por cor/variação (o modelo de custeio não
  // diferencia por cor), então um valor por produto basta.
  const costBreakdowns = await Promise.all(productOptions.map((p) => getProductCostBreakdown(p.productId)))
  const productOptionsWithCost = productOptions.map((p, i) => ({ ...p, unitCost: costBreakdowns[i].finalCost }))

  const platforms = platformRows.map((p) => ({
    kind: p.platform,
    feePercent: p.feePercent.toNumber(),
    feeFixed: p.feeFixed.toNumber(),
    feeTiers: p.feeTiers as unknown as PlatformFeeTier[] | null,
  }))

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
        colorComboKey: editingSaleRecord.colorComboKey,
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

  // Melhoria "Vendas por variante": rótulo/cor de cada venda com
  // colorComboKey -- reaproveita o label já computado em productOptions
  // (getProductVariantStockOptions) em vez de uma segunda fórmula. Venda
  // sem colorComboKey (produto sem variante, ou anterior a este ajuste)
  // simplesmente não mostra nada, nunca inventa uma cor. `attrs` (melhoria
  // "Redesign Vendas" §7) alimenta os chips por peça/cor -- fallback pro
  // par label/colorHex plano quando vazio (venda sem variante rastreada).
  const colorLabelByProductAndKey = new Map<string, { label: string; colorHex: string | null; attrs: (typeof productOptions)[number]['variants'][number]['attrs'] }>()
  for (const opt of productOptions) {
    for (const v of opt.variants) colorLabelByProductAndKey.set(`${opt.productId}::${v.key}`, { label: v.label, colorHex: v.colorHex, attrs: v.attrs })
  }

  // Melhoria "Redesign Vendas" §5/§6: cards de resumo + rodapé de totais,
  // ambos derivados de `profits`/`sales` já carregados (filtro de
  // canal/data já aplicado na query acima), sem nenhuma query nova.
  const totalSaleAmount = profits.reduce((sum, p) => sum + p.saleTotal, 0)
  const totalFees = profits.reduce((sum, p) => sum + p.platformFeeAmount, 0)
  const totalCost = profits.reduce((sum, p) => sum + p.costTotal, 0)
  const totalProfit = profits.reduce((sum, p) => sum + p.profit, 0)
  const avgTicket = sales.length > 0 ? totalSaleAmount / sales.length : 0

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Vendas</h1>

      {/* Melhoria "Redesign Vendas" §5: mesmo padrão visual dos cards de
          resumo de /stock (StockExplorer.tsx) -- refletem o filtro de
          canal/data ativo automaticamente, já que vêm de `profits`/`sales`
          filtrados acima. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total vendido</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalSaleAmount)}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total em taxas</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalFees)}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Lucro líquido</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${totalProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(totalProfit)}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Ticket médio</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(avgTicket)}</p>
        </div>
      </div>

      <div className="mt-4">
        <SaleForm
          key={editingSale?.id ?? 'new'}
          products={productOptionsWithCost}
          platforms={platforms}
          editingSale={editingSale}
          defaultProductId={productId}
        />
      </div>

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
                  ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
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
            <th>Taxa</th>
            <th>Lucro</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s, i) => {
            const { profit, estimated, saleTotal, costTotal, platformFeeAmount, platformFeeBreakdown } = profits[i]
            const colorInfo = s.colorComboKey ? colorLabelByProductAndKey.get(`${s.productId}::${s.colorComboKey}`) : undefined
            return (
              <tr key={s.id} className="tk-row align-top">
                <td className="py-2">{s.saleDate.toLocaleDateString('pt-BR')}</td>
                <td>
                  <StatusBadge badge={getSaleChannelBadge(s.channel)} />
                </td>
                <td>
                  {s.product.name}
                  {colorInfo && colorInfo.attrs.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {colorInfo.attrs.map((attr, j) => <VariantChip key={j} attr={attr} />)}
                    </div>
                  )}
                  {colorInfo && colorInfo.attrs.length === 0 && (
                    <span className="flex items-center gap-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                      {colorInfo.colorHex && <span style={{ background: colorInfo.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                      {colorInfo.label}
                    </span>
                  )}
                </td>
                <td>{s.quantity}</td>
                <td>{formatCurrency(s.unitPrice.toNumber())}</td>
                <td className="text-slate-500 dark:text-slate-400">{s.buyerOrPlatform ?? '-'}</td>
                <td>{formatCurrency(costTotal)}</td>
                <td>
                  {formatCurrency(platformFeeAmount)}
                  {platformFeeBreakdown && (
                    <span className="block text-xs font-normal text-slate-400 dark:text-slate-500">
                      {(platformFeeBreakdown.feePercent * 100).toFixed(0)}% + {formatCurrency(platformFeeBreakdown.feeFixed)}
                    </span>
                  )}
                </td>
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
                      {platformFeeAmount > 0 && (
                        <div className="flex justify-between gap-3">
                          <dt>Taxa da plataforma</dt>
                          <dd>− {formatCurrency(platformFeeAmount)}</dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-3 font-medium text-slate-700 dark:text-slate-200">
                        <dt>Lucro</dt>
                        <dd>{formatCurrency(profit)}</dd>
                      </div>
                    </dl>
                  </details>
                </td>
                <td>
                  <ActionsMenu>
                    <Link href={`/sales?editId=${s.id}`} className="tk-menu-item">
                      Editar
                    </Link>
                    <ConfirmDeleteForm action={async () => { 'use server'; return await deleteSale(s.id) }} className="tk-menu-item-danger" />
                  </ActionsMenu>
                </td>
              </tr>
            )
          })}
        </tbody>
        {sales.length > 0 && (
          // Melhoria "Redesign Vendas" §6: soma Custo/Taxa/Lucro do período
          // filtrado (mesmos `profits` já usados linha a linha acima).
          <tfoot>
            <tr className="border-t border-slate-200 font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">
              <td className="py-2" colSpan={6}>Total ({sales.length} {sales.length === 1 ? 'venda' : 'vendas'})</td>
              <td>{formatCurrency(totalCost)}</td>
              <td>{formatCurrency(totalFees)}</td>
              <td className={totalProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{formatCurrency(totalProfit)}</td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>

      {sales.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma venda registrada{activeChannel ? ' neste canal' : ''}.
        </div>
      )}
    </div>
  )
}
