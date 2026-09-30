'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateListing, deleteListing, type ListingRow as ListingRowData } from '@/actions/listings'
import { formatCurrency, LISTING_STATUS_LABELS, LISTING_FREIGHT_TYPE_LABELS, LISTING_TYPE_LABELS, getMarketplacePlatformBadge, getListingStatusBadge } from '@/lib/format'
import { resolveListingTiers, resolveListingFee, calculateListingProfit, calculateListingPriceForDesiredProfit, type PlatformFeeTier } from '@/lib/costing'
import { StatusBadge } from '@/components/StatusBadge'
import type { ListingStatus, ListingFreightType, ListingType } from '@prisma/client'

const STATUS_OPTIONS = Object.keys(LISTING_STATUS_LABELS) as ListingStatus[]
const FREIGHT_OPTIONS = Object.keys(LISTING_FREIGHT_TYPE_LABELS) as ListingFreightType[]
const LISTING_TYPE_OPTIONS = Object.keys(LISTING_TYPE_LABELS) as ListingType[]
const PROFIT_PRESETS = [8, 10, 15, 20, 25, 30]

type PlatformInfo = { id: string; feePercent: number; feeFixed: number; feeTiers: PlatformFeeTier[] | null; feeTiersPremium: PlatformFeeTier[] | null }

function chipClass(active: boolean): string {
  return `rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
  }`
}

// Melhoria "Anúncios: stepper +/-": botão redondo pequeno no lugar de todo
// <input type="number"> que o painel de edição tinha antes -- menos
// digitação, mesmo espírito do resto da melhoria (chips no lugar de
// <select>/checkbox).
function Stepper({ value, onChange, step, min = 0, format = formatCurrency }: { value: number; onChange: (v: number) => void; step: number; min?: number; format?: (v: number) => string }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} className="tk-input h-7 w-7 shrink-0 text-center leading-none">−</button>
      <span className="min-w-[4.5rem] text-center text-sm font-medium tabular-nums">{format(value)}</span>
      <button type="button" onClick={() => onChange(Math.round((value + step) * 100) / 100)} className="tk-input h-7 w-7 shrink-0 text-center leading-none">+</button>
    </div>
  )
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M13.5 3.5l3 3L6 17H3v-3L13.5 3.5z" />
    </svg>
  )
}

// Melhoria "Anúncios: linha compacta + expandir pra editar": a linha
// colapsada mostra só Produto/Plataforma/Status/Preço/Lucro -- o resto
// (Tipo, custo, taxa, frete, brinde) vira uma linha discreta abaixo do
// nome do produto (`subLine`) e um painel completo, editável, que abre ao
// clicar no lápis (accordion -- só 1 aberto por vez, estado vive no pai
// ListingsExplorer.tsx). Todo campo que antes era <select>/checkbox virou
// chip clicável; todo campo numérico (preço/frete/brinde/lucro desejado)
// virou Stepper -- objetivo "escrever menos" do pedido.
export function ListingRow({
  row,
  canHaveType,
  platform,
  isExpanded,
  onToggleExpand,
}: {
  row: ListingRowData
  canHaveType: boolean
  platform: PlatformInfo
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState(row.status)
  const [listingType, setListingType] = useState<ListingType | ''>(row.listingType ?? '')
  const [price, setPrice] = useState(row.price)
  const [freightType, setFreightType] = useState(row.freightType)
  const [freightCost, setFreightCost] = useState(row.freightCost)
  const [hasGift, setHasGift] = useState(row.hasGift)
  const [giftCost, setGiftCost] = useState(row.giftCost)
  const [priceMode, setPriceMode] = useState<'PRECO' | 'LUCRO'>('PRECO')
  const [desiredProfit, setDesiredProfit] = useState(8)

  function save(overrides: Partial<{ status: ListingStatus; listingType: ListingType | ''; price: number; freightType: ListingFreightType; freightCost: number; hasGift: boolean; giftCost: number }> = {}) {
    const values = { status, listingType, price, freightType, freightCost, hasGift, giftCost, ...overrides }
    const fd = new FormData()
    // Format KIT não tem productId (ver Listing.productId, schema.prisma) --
    // updateListing não usa esse campo no update em si (edição inline nunca
    // muda formato/produto/itens), então omitir aqui é seguro.
    if (row.productId) fd.set('productId', row.productId)
    fd.set('platformId', row.platformId)
    if (values.listingType) fd.set('listingType', values.listingType)
    fd.set('status', values.status)
    fd.set('price', String(values.price))
    fd.set('freightType', values.freightType)
    fd.set('freightCost', String(values.freightCost))
    if (values.hasGift) fd.set('hasGift', 'true')
    fd.set('giftCost', String(values.giftCost))
    startTransition(async () => {
      const result = await updateListing(row.id, fd)
      if (!result.success) {
        alert(result.error)
        return
      }
      router.refresh()
    })
  }

  function remove() {
    if (!window.confirm(`Remover o anúncio de "${row.productName}" na ${getMarketplacePlatformBadge(row.platformKind).label}?`)) return
    startTransition(async () => {
      const result = await deleteListing(row.id)
      if (!result.success) {
        alert(result.error)
        return
      }
      router.refresh()
    })
  }

  // Melhoria "calculadora de preço pelo lucro desejado": prévia ao vivo no
  // cliente, sem round-trip por clique -- resolveListingFee/
  // calculateListingProfit/calculateListingPriceForDesiredProfit são
  // funções puras (lib/costing.ts), as mesmas que o servidor usa pra
  // calcular `row.feeAmount`/`row.profit` de verdade depois de salvar.
  const tiers = resolveListingTiers({ feeTiers: platform.feeTiers, feeTiersPremium: platform.feeTiersPremium }, listingType || null)
  const liveFreightCost = freightType === 'PERSONALIZADO' ? freightCost : row.freightCost
  const liveGiftCost = hasGift ? giftCost : 0
  const livePrice = priceMode === 'LUCRO'
    ? calculateListingPriceForDesiredProfit({
        desiredProfit,
        productionCost: row.productionCost,
        freightCost: liveFreightCost,
        giftCost: liveGiftCost,
        tiers,
        flatFeePercent: platform.feePercent,
        flatFeeFixed: platform.feeFixed,
      })
    : price
  const { feeAmount: liveFeeAmount } = resolveListingFee(livePrice, tiers, platform.feePercent, platform.feeFixed)
  const liveProfit = calculateListingProfit({ price: livePrice, productionCost: row.productionCost, feeAmount: liveFeeAmount, freightCost: liveFreightCost, giftCost: liveGiftCost })
  const liveMargin = livePrice > 0 ? (liveProfit / livePrice) * 100 : 0

  function commitPrice(newPrice: number) {
    const rounded = Math.max(0, Math.round(newPrice * 100) / 100)
    setPrice(rounded)
    save({ price: rounded })
  }

  const feeLabel = row.feePercent > 0 || row.feeFixed > 0 ? `${(row.feePercent * 100).toFixed(2).replace(/\.00$/, '')}% + ${formatCurrency(row.feeFixed)}` : '—'
  const freightSummary = row.freightType === 'GRATIS_SUBSIDIADO' ? 'Frete grátis' : row.freightType === 'PAGO_COMPRADOR' ? 'Frete pago pelo comprador' : `Frete ${formatCurrency(row.freightCost)}`
  const margin = row.price > 0 ? (row.profit / row.price) * 100 : 0

  return (
    <>
      <tr className={`tk-row align-top ${isPending ? 'opacity-60' : ''}`}>
        <td className="py-2">
          <div className="flex items-center gap-1.5">
            {row.format === 'KIT' && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">Kit</span>
            )}
            {row.format === 'VARIACAO' && (
              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">Variação</span>
            )}
            <span className="font-medium text-slate-800 dark:text-slate-200">{row.productName}</span>
          </div>
          {row.format === 'KIT' ? (
            <div className="text-xs text-slate-400 dark:text-slate-500">{row.kitItems.map((i) => `${i.quantity}x ${i.productName}`).join(' + ')}</div>
          ) : row.format === 'VARIACAO' && row.includedVariants.length > 0 ? (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {row.includedVariants.map((v) => (
                <span key={v.key} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {v.colorHex && <span style={{ background: v.colorHex }} className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" />}
                  {v.label}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            Custo {formatCurrency(row.productionCost)}
            {row.format === 'KIT' && <span title="Soma automática dos itens do kit"> Σ</span>}
            {' · '}Taxa {feeLabel} · {freightSummary}
          </div>
        </td>
        <td><StatusBadge badge={getMarketplacePlatformBadge(row.platformKind)} /></td>
        <td><StatusBadge badge={getListingStatusBadge(row.status)} /></td>
        <td className="font-medium tabular-nums">{formatCurrency(row.price)}</td>
        <td>
          <span className={`font-semibold tabular-nums ${row.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(row.profit)}</span>
          <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">({margin.toFixed(0)}%)</span>
        </td>
        <td className="whitespace-nowrap">
          <button type="button" onClick={onToggleExpand} title="Editar" className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            <PencilIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={remove} className="tk-link-danger text-xs" disabled={isPending}>Remover</button>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-slate-50 dark:bg-slate-900/40">
          <td colSpan={6} className="p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_OPTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => { setStatus(s); save({ status: s }) }} className={chipClass(status === s)}>
                      {LISTING_STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {canHaveType && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Tipo de anúncio</p>
                  <div className="flex flex-wrap gap-1.5">
                    {LISTING_TYPE_OPTIONS.map((t) => (
                      <button key={t} type="button" onClick={() => { setListingType(t); save({ listingType: t }) }} className={chipClass(listingType === t)}>
                        {LISTING_TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="md:col-span-2">
                <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Definir preço por</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setPriceMode('PRECO')} className={chipClass(priceMode === 'PRECO')}>Preço do anúncio</button>
                  <button type="button" onClick={() => setPriceMode('LUCRO')} className={chipClass(priceMode === 'LUCRO')}>Lucro que quero receber</button>
                </div>

                {priceMode === 'PRECO' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Stepper value={price} step={1} onChange={commitPrice} />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Lucro: <span className={liveProfit >= 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-red-600 dark:text-red-400'}>{formatCurrency(liveProfit)}</span> ({liveMargin.toFixed(0)}%)
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {PROFIT_PRESETS.map((v) => (
                        <button key={v} type="button" onClick={() => setDesiredProfit(v)} className={chipClass(desiredProfit === v)}>{formatCurrency(v)}</button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Stepper value={desiredProfit} step={1} onChange={setDesiredProfit} />
                      <p className="text-sm">
                        Preço calculado: <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(livePrice)}</span>{' '}
                        <span className="text-xs text-slate-400 dark:text-slate-500">({liveMargin.toFixed(0)}% de margem)</span>
                      </p>
                      <button type="button" onClick={() => commitPrice(livePrice)} className="tk-btn-primary px-3 py-1 text-xs">Aplicar preço</button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Frete</p>
                <div className="flex flex-wrap gap-1.5">
                  {FREIGHT_OPTIONS.map((f) => (
                    <button key={f} type="button" onClick={() => { setFreightType(f); save({ freightType: f }) }} className={chipClass(freightType === f)}>
                      {LISTING_FREIGHT_TYPE_LABELS[f]}
                    </button>
                  ))}
                </div>
                {freightType === 'PERSONALIZADO' && (
                  <div className="mt-2">
                    <Stepper value={freightCost} step={1} onChange={(v) => { setFreightCost(v); save({ freightCost: v }) }} />
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Brinde</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => { setHasGift(false); save({ hasGift: false }) }} className={chipClass(!hasGift)}>Sem brinde</button>
                  <button type="button" onClick={() => { setHasGift(true); save({ hasGift: true }) }} className={chipClass(hasGift)}>Com brinde</button>
                </div>
                {hasGift && (
                  <div className="mt-2">
                    <Stepper value={giftCost} step={0.5} onChange={(v) => { setGiftCost(v); save({ giftCost: v }) }} />
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
