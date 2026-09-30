'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateListing, deleteListing, type ListingRow as ListingRowData } from '@/actions/listings'
import { formatCurrency, LISTING_STATUS_LABELS, LISTING_FREIGHT_TYPE_LABELS, LISTING_TYPE_LABELS, getMarketplacePlatformBadge } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'
import type { ListingStatus, ListingFreightType, ListingType } from '@prisma/client'

const STATUS_OPTIONS = Object.keys(LISTING_STATUS_LABELS) as ListingStatus[]
const FREIGHT_OPTIONS = Object.keys(LISTING_FREIGHT_TYPE_LABELS) as ListingFreightType[]
const LISTING_TYPE_OPTIONS = Object.keys(LISTING_TYPE_LABELS) as ListingType[]

// Anúncios: 1 linha da tabela "Anúncios publicados" -- tudo editável
// inline (sem página/modal de edição separada), cada mudança já salva
// (updateListing) e o breakdown de lucro é recalculado no servidor (taxa
// depende da faixa de preço configurada em Configurações) -- por isso os
// campos CALCULADOS (taxa/lucro/custo) vêm sempre de `row` (props, fresco
// após router.refresh()), enquanto os campos EDITÁVEIS ficam em estado
// local -- não seriam sobrescritos pelo refresh porque o componente
// continua montado (mesma `key`), só os valores computados mudam.
export function ListingRow({ row, canHaveType }: { row: ListingRowData; canHaveType: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState(row.status)
  const [listingType, setListingType] = useState<ListingType | ''>(row.listingType ?? '')
  const [price, setPrice] = useState(String(row.price))
  const [freightType, setFreightType] = useState(row.freightType)
  const [freightCost, setFreightCost] = useState(String(row.freightCost))
  const [hasGift, setHasGift] = useState(row.hasGift)
  const [giftCost, setGiftCost] = useState(String(row.giftCost))

  function save(overrides: Partial<{ status: ListingStatus; listingType: ListingType | ''; price: string; freightType: ListingFreightType; freightCost: string; hasGift: boolean; giftCost: string }> = {}) {
    const values = { status, listingType, price, freightType, freightCost, hasGift, giftCost, ...overrides }
    const fd = new FormData()
    // Format KIT não tem productId (ver Listing.productId, schema.prisma) --
    // updateListing não usa esse campo no update em si (edição inline nunca
    // muda formato/produto/itens), então omitir aqui é seguro.
    if (row.productId) fd.set('productId', row.productId)
    fd.set('platformId', row.platformId)
    if (values.listingType) fd.set('listingType', values.listingType)
    fd.set('status', values.status)
    fd.set('price', values.price)
    fd.set('freightType', values.freightType)
    fd.set('freightCost', values.freightCost)
    if (values.hasGift) fd.set('hasGift', 'true')
    fd.set('giftCost', values.giftCost)
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

  const feeLabel = row.feePercent > 0 || row.feeFixed > 0 ? `${(row.feePercent * 100).toFixed(2).replace(/\.00$/, '')}% + ${formatCurrency(row.feeFixed)}` : '—'

  return (
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
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {row.kitItems.map((i) => `${i.quantity}x ${i.productName}`).join(' + ')}
          </div>
        ) : row.format === 'VARIACAO' && row.includedVariants.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {row.includedVariants.map((v) => (
              <span key={v.key} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {v.colorHex && <span style={{ background: v.colorHex }} className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" />}
                {v.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-400 dark:text-slate-500">{row.productCategory}</div>
        )}
      </td>
      <td><StatusBadge badge={getMarketplacePlatformBadge(row.platformKind)} /></td>
      <td>
        {canHaveType ? (
          <select
            value={listingType}
            onChange={(e) => { const v = e.target.value as ListingType; setListingType(v); save({ listingType: v }) }}
            className="tk-input"
          >
            {LISTING_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{LISTING_TYPE_LABELS[t]}</option>)}
          </select>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">—</span>
        )}
      </td>
      <td>
        <select value={status} onChange={(e) => { const v = e.target.value as ListingStatus; setStatus(v); save({ status: v }) }} className="tk-input">
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{LISTING_STATUS_LABELS[s]}</option>)}
        </select>
      </td>
      <td className="text-slate-500 dark:text-slate-400">
        {formatCurrency(row.productionCost)}
        {row.format === 'KIT' && (
          <span title="Soma automática dos itens do kit" className="ml-1 text-xs text-slate-400 dark:text-slate-500">Σ</span>
        )}
      </td>
      <td>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400">R$</span>
          <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={() => save()} className="tk-input w-20" />
        </div>
      </td>
      <td>
        {feeLabel}
        <div className="text-xs text-slate-400 dark:text-slate-500">{formatCurrency(row.feeAmount)}</div>
      </td>
      <td>
        <select value={freightType} onChange={(e) => { const v = e.target.value as ListingFreightType; setFreightType(v); save({ freightType: v }) }} className="tk-input mb-1 min-w-[140px]">
          {FREIGHT_OPTIONS.map((f) => <option key={f} value={f}>{LISTING_FREIGHT_TYPE_LABELS[f]}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-400">Custo R$</span>
          <input type="number" step="0.01" min="0" value={freightCost} onChange={(e) => setFreightCost(e.target.value)} onBlur={() => save()} className="tk-input w-16" />
        </div>
        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={hasGift} onChange={(e) => { const v = e.target.checked; setHasGift(v); save({ hasGift: v }) }} />
          Com brinde
        </label>
        {hasGift && (
          <div className="mt-1 flex items-center gap-1">
            <span className="text-xs text-slate-400">Custo R$</span>
            <input type="number" step="0.01" min="0" value={giftCost} onChange={(e) => setGiftCost(e.target.value)} onBlur={() => save()} className="tk-input w-16" />
          </div>
        )}
      </td>
      <td>
        <span className={`font-semibold ${row.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(row.profit)}</span>
        <div className="mt-0.5 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
          {formatCurrency(row.price)} − {formatCurrency(row.productionCost)} − {formatCurrency(row.feeAmount)} (taxa)<br />
          − {formatCurrency(row.freightCost)} (frete){row.hasGift && <> − {formatCurrency(row.giftCost)} (brinde)</>}
        </div>
      </td>
      <td>
        <button type="button" onClick={remove} className="tk-link-danger text-xs" disabled={isPending}>Remover</button>
      </td>
    </tr>
  )
}
