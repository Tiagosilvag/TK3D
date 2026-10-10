'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatCurrency, getSaleChannelBadge, getMarginBadge } from '@/lib/format'
import { VariantChip } from '@/components/VariantChip'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { StatusBadge } from '@/components/StatusBadge'
import { ActionsMenu } from '@/components/ActionsMenu'
import { deleteSale, removeSaleGiftUsage, removeSaleFreight } from '@/actions/sales'
import { SaleForm, type ProductOption, type PlatformFeeInfo, type GiftProductOption } from './SaleForm'
import { PlatformFeesPanel } from './PlatformFeesPanel'
import type { VariantAttr } from '@/lib/reports'
import type { SaleChannel } from '@prisma/client'

// Redesign "Vendas": shape plano (sem Decimal/classes Prisma) pronto pro
// client component -- montado em page.tsx (Server Component) a partir
// dos MESMOS `sales`/`profits`/`batches` que a tela já calculava, só
// convertido pra JSON-safe antes de atravessar a fronteira Server→Client.
export interface SaleItemRow {
  id: string
  productName: string
  quantity: number
  unitPrice: number
  saleTotal: number
  costTotal: number
  platformFeeAmount: number
  platformFeeBreakdown: { feePercent: number; feeFixed: number } | null
  profit: number
  estimated: boolean
  // Attrs estruturados (peça/cor por hierarquia, VariantChip compact) --
  // vazio quando a venda não tem colorComboKey ou é anterior ao
  // rastreamento de attrs (cai no fallback colorLabel/colorHex).
  colorAttrs: VariantAttr[]
  colorLabel: string | null
  colorHex: string | null
}

export interface SaleBatchRow {
  batchId: string
  channel: SaleChannel
  buyerOrPlatform: string | null
  items: SaleItemRow[]
  // Bolinhas únicas (dedupe por hex) de todas as cores dos itens, pra
  // tira da linha-resumo -- label é só pro tooltip de cada bolinha.
  colorDots: { hex: string; label: string }[]
  gift: { id: string; productName: string; cost: number } | null
  freight: { id: string; cost: number } | null
  totals: {
    quantity: number
    saleTotal: number
    platformFeeAmount: number
    received: number
    costTotal: number
    profit: number
    margin: number | null
  }
}

export interface SaleDayGroup {
  dateKey: string
  dateLabel: string
  batches: SaleBatchRow[]
  count: number
  received: number
  profit: number
}

const CHANNEL_FILTERS: { value: SaleChannel | undefined; label: string }[] = [
  { value: undefined, label: 'Todas' },
  { value: 'DIRETA', label: 'Direta' },
  { value: 'SHOPEE', label: 'Shopee' },
  { value: 'MERCADO_LIVRE', label: 'Mercado Livre' },
  { value: 'MARKETPLACE', label: 'Marketplace (antigo)' },
]

function matchesSearch(batch: SaleBatchRow, term: string): boolean {
  if (!term) return true
  const needle = term.toLowerCase()
  if (batch.buyerOrPlatform?.toLowerCase().includes(needle)) return true
  return batch.items.some((i) => i.productName.toLowerCase().includes(needle))
}

function BatchRow({ batch, expanded, onToggle }: { batch: SaleBatchRow; expanded: boolean; onToggle: () => void }) {
  const marginBadge = getMarginBadge(batch.totals.margin)

  return (
    <div className="tk-panel overflow-hidden p-0">
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`mt-0.5 inline-block shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${expanded ? 'rotate-90' : ''}`}>▶</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-slate-100">{batch.buyerOrPlatform ?? '—'}</span>
              <StatusBadge badge={getSaleChannelBadge(batch.channel)} />
              <span className="text-xs text-slate-400 dark:text-slate-500">{batch.items.length} {batch.items.length === 1 ? 'item' : 'itens'}</span>
            </div>
            {batch.colorDots.length > 0 && (
              <div className="mt-1.5 flex">
                {batch.colorDots.map((d, i) => (
                  <span
                    key={d.hex + i}
                    title={d.label}
                    style={{ background: d.hex }}
                    className={`inline-block h-3 w-3 rounded-full border border-white dark:border-slate-900 ${i > 0 ? '-ml-1' : ''}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-4 text-right text-sm tabular-nums">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Qtd.</p>
            <p>{batch.totals.quantity}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Bruto</p>
            <p>{formatCurrency(batch.totals.saleTotal)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Taxa</p>
            <p>{formatCurrency(batch.totals.platformFeeAmount)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Recebido</p>
            <p className="font-medium">{formatCurrency(batch.totals.received)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Custo</p>
            <p>{formatCurrency(batch.totals.costTotal)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Lucro</p>
            <p className={`font-semibold ${marginBadge.className}`}>
              {formatCurrency(batch.totals.profit)}
              {batch.totals.margin !== null && <span className="ml-1 text-xs font-normal">({(batch.totals.margin * 100).toFixed(0)}%)</span>}
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
          {batch.gift && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700 dark:bg-pink-900/40 dark:text-pink-300">
                🎁 + {batch.gift.productName}
              </span>
              <ConfirmDeleteForm action={() => removeSaleGiftUsage(batch.gift!.id)} confirmMessage="Remover o brinde desta venda?" />
            </div>
          )}
          {batch.freight && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                📦 Frete {formatCurrency(batch.freight.cost)}
              </span>
              <ConfirmDeleteForm action={() => removeSaleFreight(batch.freight!.id)} confirmMessage="Remover o frete desta venda?" />
            </div>
          )}
          {batch.items.map((item) => {
            const itemMargin = getMarginBadge(item.saleTotal - item.platformFeeAmount > 0 ? item.profit / (item.saleTotal - item.platformFeeAmount) : null)
            return (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.productName}
                    <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{item.quantity} × {formatCurrency(item.unitPrice)}</span>
                  </p>
                  {item.colorAttrs.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {item.colorAttrs.map((attr, j) => <VariantChip key={j} attr={attr} variant="compact" />)}
                    </div>
                  )}
                  {item.colorAttrs.length === 0 && item.colorLabel && (
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      {item.colorHex && <span style={{ background: item.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                      {item.colorLabel}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-4 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  <span>Bruto {formatCurrency(item.saleTotal)}</span>
                  <span>Taxa {formatCurrency(item.platformFeeAmount)}</span>
                  <span>Custo {formatCurrency(item.costTotal)}</span>
                  <span className={`font-medium ${itemMargin.className}`}>
                    Lucro {formatCurrency(item.profit)}{item.estimated && <span title="Venda anterior a este recurso: custo estimado, pode variar" className="ml-0.5">*</span>}
                  </span>
                  <ActionsMenu>
                    <Link href={`/sales?editId=${item.id}`} className="tk-menu-item">Editar</Link>
                    <ConfirmDeleteForm action={() => deleteSale(item.id)} className="tk-menu-item-danger" />
                  </ActionsMenu>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SalesExplorer({
  dayGroups,
  channelCounts,
  activeChannel,
  range,
  products,
  platforms,
  giftProducts,
  editingSale,
  defaultProductId,
}: {
  dayGroups: SaleDayGroup[]
  channelCounts: Record<string, number>
  activeChannel: SaleChannel | undefined
  range: { from: string; to: string }
  products: ProductOption[]
  platforms: PlatformFeeInfo[]
  giftProducts: GiftProductOption[]
  editingSale?: Parameters<typeof SaleForm>[0]['editingSale']
  // 2.2: link de ação rápida "Registrar venda direta" em /stock chega com
  // ?productId=... pra pré-selecionar o produto -- formulário já abre
  // direto nesse caso (senão o link cairia numa tela sem o form visível).
  defaultProductId?: string
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [formOpen, setFormOpen] = useState(Boolean(editingSale) || Boolean(defaultProductId))
  const [taxasOpen, setTaxasOpen] = useState(false)

  const allBatchIds = useMemo(() => dayGroups.flatMap((d) => d.batches.map((b) => b.batchId)), [dayGroups])
  const allExpanded = allBatchIds.length > 0 && allBatchIds.every((id) => expanded.has(id))

  function toggleBatch(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setExpanded(allExpanded ? new Set() : new Set(allBatchIds))
  }

  const filteredDayGroups = useMemo(() => {
    if (!search.trim()) return dayGroups
    return dayGroups
      .map((day) => ({ ...day, batches: day.batches.filter((b) => matchesSearch(b, search)) }))
      .filter((day) => day.batches.length > 0)
  }, [dayGroups, search])

  const totalBatches = dayGroups.reduce((sum, d) => sum + d.batches.length, 0)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por comprador ou produto..."
            className="tk-input w-64"
          />
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setTaxasOpen((v) => !v)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {taxasOpen ? 'Ocultar taxas cadastradas' : 'Ver taxas cadastradas'}
          </button>
          <button type="button" onClick={() => setFormOpen((v) => !v)} className="tk-btn-primary">
            {formOpen ? 'Fechar' : '+ Nova venda'}
          </button>
        </div>
      </div>

      {taxasOpen && (
        <div className="mt-3">
          <PlatformFeesPanel platforms={platforms} />
        </div>
      )}

      {formOpen && (
        <div className="mt-3">
          <SaleForm products={products} platforms={platforms} giftProducts={giftProducts} editingSale={editingSale} defaultProductId={defaultProductId} />
        </div>
      )}

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {CHANNEL_FILTERS.map((f) => {
            const qs = new URLSearchParams()
            if (f.value) qs.set('channel', f.value)
            qs.set('from', range.from)
            qs.set('to', range.to)
            const href = `/sales?${qs.toString()}`
            const isActive = activeChannel === f.value
            const count = f.value ? (channelCounts[f.value] ?? 0) : totalBatches
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
                {f.label} {count}
              </Link>
            )
          })}
        </div>
        {allBatchIds.length > 0 && (
          <button type="button" onClick={toggleAll} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
            {allExpanded ? 'Recolher tudo' : 'Expandir tudo'}
          </button>
        )}
      </div>

      <div className="space-y-6">
        {filteredDayGroups.map((day) => (
          <div key={day.dateKey}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-violet-700 dark:text-violet-400">{day.dateLabel}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {day.count} {day.count === 1 ? 'venda' : 'vendas'} · Recebido {formatCurrency(day.received)} · Lucro {formatCurrency(day.profit)}
              </p>
            </div>
            <div className="space-y-2">
              {day.batches.map((batch) => (
                <BatchRow key={batch.batchId} batch={batch} expanded={expanded.has(batch.batchId)} onToggle={() => toggleBatch(batch.batchId)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {filteredDayGroups.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma venda encontrada{activeChannel ? ' neste canal' : ''}{search ? ' para esta busca' : ''}.
        </div>
      )}

      {filteredDayGroups.length > 0 && (
        <p className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Margem ≥ 40%</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Margem 20–40%</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Margem &lt; 20%</span>
        </p>
      )}
    </div>
  )
}
