import { prisma } from '@/lib/prisma'
import { formatCurrency, formatDayHeader } from '@/lib/format'
import { getSaleProfit, getSaleBatchCountsByChannel } from '@/actions/sales'
import { getProductCostBreakdown, getGiftProductOptions } from '@/actions/products'
import { getProductVariantStockOptions } from '@/lib/reports'
import type { PlatformFeeTier } from '@/lib/costing'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { resolveDateRange } from '@/lib/dateRange'
import { SalesExplorer, type SaleDayGroup, type SaleBatchRow, type SaleItemRow } from './SalesExplorer'
import type { SaleChannel } from '@prisma/client'

export const dynamic = 'force-dynamic'

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

  const [sales, productOptions, editingSaleRecord, platformRows, giftProducts, channelCounts] = await Promise.all([
    prisma.sale.findMany({
      where: { ...(activeChannel ? { channel: activeChannel } : {}), saleDate: { gte: range.gte, lte: range.lte } },
      orderBy: { saleDate: 'desc' },
      include: { product: true },
    }),
    // Brinde nunca é vendido sozinho -- excluído do seletor (já filtrado
    // dentro de getProductVariantStockOptions).
    getProductVariantStockOptions(),
    editId ? prisma.sale.findUnique({ where: { id: editId } }) : null,
    // Melhoria "Redesign Vendas": taxas cadastradas de cada plataforma,
    // pro painel de referência (4) e pra prévia ao vivo do formulário (3)
    // calcularem a taxa client-side sem round-trip a cada campo mudado --
    // mesmo dado que settings/page.tsx já usa, reaproveitando PlatformFeeTier.
    prisma.marketplacePlatform.findMany({ orderBy: { platform: 'asc' } }),
    // Brinde: opções pro seletor "Qual brinde" do formulário.
    getGiftProductOptions(),
    // Redesign "Vendas" §6: contagem de vendas (batchId) por canal no
    // mesmo período filtrado, independente do canal ativo -- pras abas
    // mostrarem a contagem de TODOS os canais ao mesmo tempo.
    getSaleBatchCountsByChannel({ gte: range.gte, lte: range.lte }),
  ])

  // Brinde: anexo por LOTE (não por linha de Sale) -- busca depois de
  // `sales` porque depende dos batchId já carregados (respeitando o mesmo
  // filtro de canal/data da query acima, por tabela).
  const batchIds = [...new Set(sales.map((s) => s.batchId))]
  const giftUsages = batchIds.length > 0
    ? await prisma.saleGiftUsage.findMany({ where: { batchId: { in: batchIds } }, include: { product: true } })
    : []
  const giftUsageByBatchId = new Map(giftUsages.map((g) => [g.batchId, g]))

  // Melhoria "Frete em Vendas": mesmo padrão do Brinde acima -- por LOTE
  // (um envio cobre a venda inteira, não cada produto dela separadamente),
  // nunca uma coluna em Sale (evitaria contar o mesmo frete várias vezes
  // numa venda de vários produtos).
  const freights = batchIds.length > 0
    ? await prisma.saleFreight.findMany({ where: { batchId: { in: batchIds } } })
    : []
  const freightByBatchId = new Map(freights.map((f) => [f.batchId, f]))

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

  // Melhoria "Vendas por variante": rótulo/cor/attrs de cada venda com
  // colorComboKey -- reaproveita o que já foi computado em
  // getProductVariantStockOptions em vez de uma segunda fórmula. Venda
  // sem colorComboKey (produto sem variante, ou anterior a este ajuste)
  // simplesmente não mostra nada, nunca inventa uma cor.
  const colorInfoByProductAndKey = new Map<string, { label: string; colorHex: string | null; attrs: (typeof productOptions)[number]['variants'][number]['attrs'] }>()
  for (const opt of productOptions) {
    for (const v of opt.variants) colorInfoByProductAndKey.set(`${opt.productId}::${v.key}`, { label: v.label, colorHex: v.colorHex, attrs: v.attrs })
  }

  // Melhoria "Vendas: múltiplos produtos numa venda": agrupa as linhas de
  // Sale por batchId (mesmo padrão Map-por-batchId de
  // app/(app)/consignment/deliveries/page.tsx).
  const batchesMap = new Map<string, { batchId: string; saleDate: Date; channel: SaleChannel; buyerOrPlatform: string | null; gift: (typeof giftUsages)[number] | null; freight: (typeof freights)[number] | null; lines: { sale: (typeof sales)[number]; profit: (typeof profits)[number] }[] }>()
  for (let i = 0; i < sales.length; i++) {
    const s = sales[i]
    const batch = batchesMap.get(s.batchId) ?? { batchId: s.batchId, saleDate: s.saleDate, channel: s.channel, buyerOrPlatform: s.buyerOrPlatform, gift: giftUsageByBatchId.get(s.batchId) ?? null, freight: freightByBatchId.get(s.batchId) ?? null, lines: [] }
    batch.lines.push({ sale: s, profit: profits[i] })
    batchesMap.set(s.batchId, batch)
  }
  const batches = [...batchesMap.values()]

  // Redesign "Vendas" §5/§6: cards de resumo + rodapé de totais, ambos
  // derivados de `profits`/`sales` já carregados (filtro de canal/data já
  // aplicado na query acima), sem nenhuma query nova. Brinde: soma do
  // custo de todos os brindes anexados nos lotes visíveis (giftUsages já
  // vem filtrado pelos mesmos batchIds de `sales`) -- entra no custo
  // total/desconta do lucro, nunca no valor vendido.
  const totalGiftCost = giftUsages.reduce((sum, g) => sum + g.unitCost.toNumber() * g.quantity, 0)
  const totalFreightCost = freights.reduce((sum, f) => sum + f.amount.toNumber(), 0)

  const totalSaleAmount = profits.reduce((sum, p) => sum + p.saleTotal, 0)
  const totalFees = profits.reduce((sum, p) => sum + p.platformFeeAmount, 0)
  const totalProfit = profits.reduce((sum, p) => sum + p.profit, 0) - totalGiftCost - totalFreightCost
  const totalReceived = totalSaleAmount - totalFees - totalFreightCost

  const avgTicket = batches.length > 0 ? totalSaleAmount / batches.length : 0

  // Redesign "Vendas": monta o shape plano (JSON-safe) consumido pelo
  // client component -- cada batch sempre ganha um `totals` calculado com
  // a MESMA fórmula que a sub-linha "Total desta venda" já usava pra lote
  // de 2+ produtos (gift/freight entram 1x por lote, nunca por linha),
  // agora aplicada uniformemente também pro lote de 1 produto só (produz
  // exatamente o mesmo número que a linha única já mostrava).
  const saleBatchRows: SaleBatchRow[] = batches.map((batch) => {
    const batchGiftCost = batch.gift ? batch.gift.unitCost.toNumber() * batch.gift.quantity : 0
    const batchFreightCost = batch.freight ? batch.freight.amount.toNumber() : 0

    const items: SaleItemRow[] = batch.lines.map(({ sale: s, profit: p }) => {
      const colorInfo = s.colorComboKey ? colorInfoByProductAndKey.get(`${s.productId}::${s.colorComboKey}`) : undefined
      return {
        id: s.id,
        productName: s.product.name,
        quantity: s.quantity,
        unitPrice: s.unitPrice.toNumber(),
        saleTotal: p.saleTotal,
        costTotal: p.costTotal,
        platformFeeAmount: p.platformFeeAmount,
        platformFeeBreakdown: p.platformFeeBreakdown,
        profit: p.profit,
        estimated: p.estimated,
        colorAttrs: colorInfo?.attrs ?? [],
        colorLabel: colorInfo?.label ?? null,
        colorHex: colorInfo?.colorHex ?? null,
      }
    })

    const totals = batch.lines.reduce(
      (acc, { profit: p }) => ({
        saleTotal: acc.saleTotal + p.saleTotal,
        platformFeeAmount: acc.platformFeeAmount + p.platformFeeAmount,
        costTotal: acc.costTotal + p.costTotal,
        profit: acc.profit + p.profit,
      }),
      { saleTotal: 0, platformFeeAmount: 0, costTotal: 0, profit: 0 },
    )
    const quantity = batch.lines.reduce((sum, { sale: s }) => sum + s.quantity, 0)
    const costTotal = totals.costTotal + batchGiftCost
    const profit = totals.profit - batchGiftCost - batchFreightCost
    const received = totals.saleTotal - totals.platformFeeAmount - batchFreightCost

    // Tira de bolinhas: cores únicas (dedupe por hex) de todos os itens --
    // usa attrs quando existir (pode ter mais de 1 cor por item, peça
    // multi-filamento), senão o colorHex plano de fallback.
    const dotsByHex = new Map<string, string>()
    for (const item of items) {
      if (item.colorAttrs.length > 0) {
        for (const attr of item.colorAttrs) {
          for (const hex of attr.colorHexes) if (!dotsByHex.has(hex)) dotsByHex.set(hex, attr.value || attr.shortValue)
        }
      } else if (item.colorHex) {
        if (!dotsByHex.has(item.colorHex)) dotsByHex.set(item.colorHex, item.colorLabel ?? '')
      }
    }

    return {
      batchId: batch.batchId,
      channel: batch.channel,
      buyerOrPlatform: batch.buyerOrPlatform,
      items,
      colorDots: [...dotsByHex.entries()].map(([hex, label]) => ({ hex, label })),
      gift: batch.gift ? { id: batch.gift.id, productName: batch.gift.product.name, cost: batchGiftCost } : null,
      freight: batch.freight ? { id: batch.freight.id, cost: batchFreightCost } : null,
      totals: { quantity, saleTotal: totals.saleTotal, platformFeeAmount: totals.platformFeeAmount, received, costTotal, profit, margin: received > 0 ? profit / received : null },
    }
  })

  // Redesign "Vendas" §1: agrupa os batches (já ordenados desc por
  // saleDate, herdado de `sales`) por dia em Brasília -- Map preserva a
  // ordem de 1ª inserção, então os dias já saem do mais recente pro mais
  // antigo sem precisar reordenar.
  const dayGroupsMap = new Map<string, { date: Date; batches: SaleBatchRow[] }>()
  for (let i = 0; i < batches.length; i++) {
    const dateKey = batches[i].saleDate.toISOString().slice(0, 10)
    const entry = dayGroupsMap.get(dateKey) ?? { date: batches[i].saleDate, batches: [] }
    entry.batches.push(saleBatchRows[i])
    dayGroupsMap.set(dateKey, entry)
  }
  const dayGroups: SaleDayGroup[] = [...dayGroupsMap.entries()].map(([dateKey, { date, batches: dayBatches }]) => ({
    dateKey,
    dateLabel: formatDayHeader(date),
    batches: dayBatches,
    count: dayBatches.length,
    received: dayBatches.reduce((sum, b) => sum + b.totals.received, 0),
    profit: dayBatches.reduce((sum, b) => sum + b.totals.profit, 0),
  }))

  // Redesign "Vendas" §7: subtexto de apoio embaixo de cada card de KPI --
  // "últimos 30 dias" só quando o usuário não escolheu um período
  // explícito na URL (resolveDateRange cai no padrão de 30 dias nesse
  // caso); com from/to na URL, mostra o período de fato aplicado.
  const periodLabel = !from && !to ? 'últimos 30 dias' : `${new Date(`${range.from}T00:00:00`).toLocaleDateString('pt-BR')} – ${new Date(`${range.to}T00:00:00`).toLocaleDateString('pt-BR')}`
  const feesPercentOfSold = totalSaleAmount > 0 ? (totalFees / totalSaleAmount) * 100 : 0
  const freightPercentOfSold = totalSaleAmount > 0 ? (totalFreightCost / totalSaleAmount) * 100 : 0
  const netMarginOnReceived = totalReceived > 0 ? (totalProfit / totalReceived) * 100 : null

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Vendas</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total vendido</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalSaleAmount)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{periodLabel}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total em taxas</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalFees)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{feesPercentOfSold.toFixed(1)}% do vendido</p>
        </div>
        {totalFreightCost > 0 && (
          <div className="tk-panel p-3">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total em frete</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalFreightCost)}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{freightPercentOfSold.toFixed(1)}% do vendido</p>
          </div>
        )}
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Lucro líquido</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${totalProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(totalProfit)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{netMarginOnReceived !== null ? `${netMarginOnReceived.toFixed(0)}% de margem` : '—'}</p>
        </div>
        <div className="tk-panel p-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Ticket médio</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(avgTicket)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">por venda</p>
        </div>
      </div>

      <DateRangeFilter action="/sales" from={range.from} to={range.to} hiddenParams={{ channel: activeChannel }} />

      <div className="mt-2">
        <SalesExplorer
          dayGroups={dayGroups}
          channelCounts={channelCounts}
          activeChannel={activeChannel}
          range={{ from: range.from, to: range.to }}
          products={productOptionsWithCost}
          platforms={platforms}
          giftProducts={giftProducts}
          editingSale={editingSale}
          defaultProductId={productId}
        />
      </div>

      {sales.length === 0 && dayGroups.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma venda registrada{activeChannel ? ' neste canal' : ''}.
        </div>
      )}
    </div>
  )
}
