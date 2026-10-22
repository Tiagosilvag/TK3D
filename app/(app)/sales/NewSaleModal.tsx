'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createSaleFromModal, updateSaleFromModal, getSaleModalInput, type SaleModalInput } from '@/actions/saleModal'
import { getPlatformSalePrice, resolveSaleFreight } from '@/actions/marketplacePlatforms'
import { VariacaoPecas } from '@/components/VariacaoPecas'
import { calculateSale, automaticFee } from '@/lib/saleModal'
import { formatCurrency } from '@/lib/format'
import { todayInBrasiliaString } from '@/lib/timezone'
import { normalizeText } from '@/lib/filamentPicker'
import type { VariantAttr } from '@/lib/reports'
import type { MarketplacePlatformKind, SaleChannel } from '@prisma/client'
import type { PlatformFeeInfo, GiftProductOption } from './types'

export interface SaleModalVariant {
  key: string
  label: string
  colorHex: string | null
  available: number
  attrs: VariantAttr[]
}

export interface SaleModalProduct {
  productId: string
  productName: string
  variants: SaleModalVariant[]
  // Custo de produção por unidade SEM embalagem.
  productionCostPerUnit: number
  defaultPackaging: { packagingItemId: string; quantityPerUnit: number }[]
  // Preço da Direta (Produtos > Preço por canal); null = sem preço cadastrado.
  directPrice: number | null
}

export interface SaleModalPackagingItem {
  id: string
  name: string
  stock: number
  unitCost: number
}

type ChannelValue = 'DIRETA' | 'SHOPEE' | 'MERCADO_LIVRE'
const CHANNELS: { value: ChannelValue; label: string }[] = [
  { value: 'DIRETA', label: 'Direta' },
  { value: 'SHOPEE', label: 'Shopee' },
  { value: 'MERCADO_LIVRE', label: 'Mercado Livre' },
]
const LAST_CHANNEL_KEY = 'tk3d:sale-last-channel'

interface PackLine {
  packagingItemId: string
  qpu: string
}

const money = (n: number) => formatCurrency(n)
const num = (s: string) => Number(s.replace(',', '.'))

// Venda com o lucro na hora: campos à esquerda, a CONTA DO LUCRO fixa à
// direita (mesma função do servidor, então o que aparece é o que fica gravado).
// Tudo que vem preenchido é sugestão: o que o usuário já editou nunca é
// sobrescrito ao trocar de produto/plataforma. Enter registra, Esc fecha.
export function NewSaleModal({
  products,
  packagingItems,
  giftProducts,
  platforms,
  recentProductIds,
  editing,
  defaultProductId,
  onClose,
  onSaved,
}: {
  products: SaleModalProduct[]
  packagingItems: SaleModalPackagingItem[]
  giftProducts: GiftProductOption[]
  platforms: PlatformFeeInfo[]
  recentProductIds: string[]
  editing?: { saleId: string; input: SaleModalInput }
  defaultProductId?: string
  onClose: () => void
  onSaved: (message: string, undoSaleId: string | null) => void
}) {
  const initial = editing?.input
  const [channel, setChannel] = useState<ChannelValue>(initial?.channel ?? 'DIRETA')
  const [saleDate, setSaleDate] = useState(initial?.saleDate ?? todayInBrasiliaString())
  const [buyer, setBuyer] = useState(initial?.buyer ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [productId, setProductId] = useState(initial?.productId ?? defaultProductId ?? '')
  const [variantKey, setVariantKey] = useState(initial?.colorComboKey ?? '')
  const [search, setSearch] = useState('')
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1))
  const [unitPrice, setUnitPrice] = useState(initial ? String(initial.unitPrice) : '')
  const [freight, setFreight] = useState(initial ? String(initial.freight) : '0')
  const [feeManual, setFeeManual] = useState<string | null>(initial?.platformFeeTotal != null ? String(initial.platformFeeTotal) : null)
  const [packLines, setPackLines] = useState<PackLine[]>(initial?.packaging.map((l) => ({ packagingItemId: l.packagingItemId, qpu: String(l.quantityPerUnit) })) ?? [])
  const [giftOn, setGiftOn] = useState(Boolean(initial?.gift))
  const [giftProductId, setGiftProductId] = useState(initial?.gift?.productId ?? giftProducts[0]?.id ?? '')
  const [giftQty, setGiftQty] = useState(String(initial?.gift?.quantity ?? 1))
  const [giftCost, setGiftCost] = useState(String(initial?.gift?.unitCost ?? giftProducts[0]?.unitCost ?? 0))
  const [listingType, setListingType] = useState<'CLASSICO' | 'PREMIUM'>(initial?.listingType ?? 'CLASSICO')
  const [listingPrice, setListingPrice] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // O que o usuário já mexeu: automático nunca sobrescreve.
  const touched = useRef({ price: Boolean(initial), freight: Boolean(initial), packaging: Boolean(initial), gift: Boolean(initial) })
  const autofillToken = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const product = useMemo(() => products.find((p) => p.productId === productId) ?? null, [products, productId])
  const packagingById = useMemo(() => new Map(packagingItems.map((p) => [p.id, p])), [packagingItems])
  const basePlatform = platforms.find((p) => p.kind === channel) ?? null
  // Mercado Livre: Premium usa a 2ª tabela de faixas.
  const platform = basePlatform && channel === 'MERCADO_LIVRE' && listingType === 'PREMIUM' && basePlatform.feeTiersPremium?.length ? { ...basePlatform, feeTiers: basePlatform.feeTiersPremium } : basePlatform

  useEffect(() => {
    if (initial) return
    try {
      const last = window.localStorage.getItem(LAST_CHANNEL_KEY)
      if (last === 'SHOPEE' || last === 'MERCADO_LIVRE' || last === 'DIRETA') setChannel(last)
    } catch {
      // sem localStorage: começa em Direta.
    }
    searchRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na abertura
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Preço, frete, embalagem e brinde automáticos ao trocar produto/plataforma
  // (só nos campos que o usuário ainda não editou).
  useEffect(() => {
    if (!product) return
    const token = ++autofillToken.current
    if (!touched.current.packaging) {
      setPackLines(product.defaultPackaging.map((l) => ({ packagingItemId: l.packagingItemId, qpu: String(l.quantityPerUnit) })))
    }
    if (!touched.current.gift) {
      const first = giftProducts[0]
      setGiftOn(channel === 'SHOPEE' && Boolean(first))
      if (first) {
        setGiftProductId(first.id)
        setGiftCost(String(first.unitCost))
      }
    }
    async function fill() {
      let price: number | null = null
      let freightValue = 0
      if (channel === 'DIRETA') {
        price = product!.directPrice
      } else {
        try {
          const [result, fr] = await Promise.all([
            getPlatformSalePrice(product!.productId, channel as MarketplacePlatformKind, channel === 'MERCADO_LIVRE' ? listingType : undefined),
            resolveSaleFreight(channel as SaleChannel, product!.productId),
          ])
          price = result.price
          freightValue = fr
        } catch {
          // sem anúncio nem taxa cadastrada: o usuário digita.
        }
      }
      if (token !== autofillToken.current) return
      setListingPrice(price)
      if (!touched.current.price && price !== null) setUnitPrice(price.toFixed(2))
      if (!touched.current.freight) setFreight(freightValue.toFixed(2))
    }
    void fill()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando produto/plataforma mudam
  }, [productId, channel, listingType])

  function chooseProduct(p: SaleModalProduct) {
    setProductId(p.productId)
    setSearch('')
    setError(null)
    const best = [...p.variants].sort((a, b) => b.available - a.available)[0]
    setVariantKey(best ? best.key : '')
    // Trocar de produto volta a seguir o produto novo (preço, frete, embalagem).
    touched.current.price = false
    touched.current.freight = false
    touched.current.packaging = false
  }

  function changeChannel(next: ChannelValue) {
    setChannel(next)
    setFeeManual(null)
    try {
      window.localStorage.setItem(LAST_CHANNEL_KEY, next)
    } catch {
      // ignora
    }
  }

  const quantityNum = Math.floor(num(quantity)) || 0
  const priceNum = num(unitPrice) || 0
  const freightNum = Math.max(0, num(freight) || 0)
  const selectedVariant = product?.variants.find((v) => v.key === variantKey) ?? null
  const allowedStock = selectedVariant ? selectedVariant.available + (editing && editing.input.productId === productId && (editing.input.colorComboKey ?? '') === variantKey ? editing.input.quantity : 0) : null

  const auto = automaticFee(platform, priceNum, quantityNum)
  const feeTotal = feeManual !== null ? Math.max(0, num(feeManual) || 0) : auto.total
  const gift = giftOn && giftProductId ? { productId: giftProductId, quantity: Math.max(0, Math.floor(num(giftQty)) || 0), unitCost: Math.max(0, num(giftCost) || 0) } : null
  const lines = packLines.map((l) => ({ packagingItemId: l.packagingItemId, quantityPerUnit: num(l.qpu) || 0, unitCost: packagingById.get(l.packagingItemId)?.unitCost ?? 0 }))

  const calc = calculateSale({
    quantity: quantityNum,
    unitPrice: priceNum,
    productionCostPerUnit: product?.productionCostPerUnit ?? 0,
    packagingLines: lines,
    feeTotal,
    freight: freightNum,
    gift: gift && gift.quantity > 0 ? gift : null,
  })

  const stockWarnings = lines
    .filter((l) => l.packagingItemId && l.quantityPerUnit > 0)
    .map((l) => {
      const item = packagingById.get(l.packagingItemId)
      const need = l.quantityPerUnit * quantityNum
      return item && need > item.stock ? { name: item.name, stock: item.stock, need } : null
    })
    .filter((w): w is { name: string; stock: number; need: number } => w !== null)

  let disabledReason: string | null = null
  if (!product) disabledReason = 'Escolha o produto.'
  else if (product.variants.length > 0 && !selectedVariant) disabledReason = 'Escolha a variação.'
  else if (quantityNum < 1) disabledReason = 'Informe a quantidade.'
  else if (allowedStock !== null && quantityNum > allowedStock) disabledReason = `Só há ${allowedStock} dessa variação em estoque.`
  else if (!(priceNum > 0)) disabledReason = 'Informe o valor unitário.'
  else if (packLines.some((l) => !l.packagingItemId)) disabledReason = 'Escolha o tipo de cada embalagem.'

  const results = useMemo(() => {
    const needle = normalizeText(search.trim())
    const rank = new Map(recentProductIds.map((id, i) => [id, i]))
    return products
      .filter((p) => !needle || normalizeText(p.productName).includes(needle))
      .sort((a, b) => (rank.get(a.productId) ?? 999) - (rank.get(b.productId) ?? 999) || a.productName.localeCompare(b.productName, 'pt-BR'))
      .slice(0, needle ? 12 : 8)
  }, [products, search, recentProductIds])

  function buildInput(): SaleModalInput {
    return {
      channel,
      saleDate,
      buyer: buyer.trim() || null,
      notes: notes.trim() || null,
      productId,
      colorComboKey: variantKey || null,
      quantity: quantityNum,
      unitPrice: priceNum,
      freight: freightNum,
      platformFeeTotal: feeManual !== null ? feeTotal : null,
      listingType: channel === 'MERCADO_LIVRE' ? listingType : null,
      packaging: lines.filter((l) => l.quantityPerUnit > 0).map((l) => ({ packagingItemId: l.packagingItemId, quantityPerUnit: l.quantityPerUnit })),
      gift: gift && gift.quantity > 0 ? gift : null,
    }
  }

  async function submit(again: boolean) {
    if (busy || disabledReason) return
    setBusy(true)
    setError(null)
    const input = buildInput()
    const result = editing ? await updateSaleFromModal(editing.saleId, input) : await createSaleFromModal(input)
    setBusy(false)
    if (!result.success) return setError(result.error ?? 'Não foi possível registrar a venda.')
    const profitText = result.profit !== undefined ? ` Lucro ${money(result.profit)}.` : ''
    onSaved(`${editing ? 'Venda atualizada' : 'Venda registrada'}: ${product?.productName}.${profitText}`, editing ? null : (result.saleId ?? null))
    if (again && !editing) {
      // Mantém o modal e a plataforma; volta o foco pro produto.
      setProductId('')
      setVariantKey('')
      setSearch('')
      setQuantity('1')
      setUnitPrice('')
      setFreight('0')
      setFeeManual(null)
      setPackLines([])
      setListingPrice(null)
      touched.current = { price: false, freight: false, packaging: false, gift: false }
      searchRef.current?.focus()
    } else {
      onClose()
    }
  }

  async function repeatLast() {
    const last = await getSaleModalInput('latest')
    if (!last) return setError('Ainda não há venda para repetir.')
    touched.current = { price: true, freight: true, packaging: true, gift: true }
    setChannel(last.channel)
    setBuyer(last.buyer ?? '')
    setNotes(last.notes ?? '')
    setProductId(last.productId)
    setVariantKey(last.colorComboKey ?? '')
    setQuantity(String(last.quantity))
    setUnitPrice(String(last.unitPrice))
    setFreight(String(last.freight))
    setFeeManual(last.platformFeeTotal !== null ? String(last.platformFeeTotal) : null)
    setPackLines(last.packaging.map((l) => ({ packagingItemId: l.packagingItemId, qpu: String(l.quantityPerUnit) })))
    setGiftOn(Boolean(last.gift))
    if (last.gift) {
      setGiftProductId(last.gift.productId)
      setGiftQty(String(last.gift.quantity))
      setGiftCost(String(last.gift.unitCost))
    }
    setError(null)
  }

  const input = 'tk-input-full'
  const label = 'text-xs text-slate-500 dark:text-slate-400'
  const marginTone = calc.profit < 0 ? 'text-red-600 dark:text-red-400' : calc.marginPct !== null && calc.marginPct < 20 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-3 sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !product) onClose() }}
    >
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Editar venda' : 'Nova venda'}
        onSubmit={(e) => { e.preventDefault(); void submit(false) }}
        className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold">{editing ? 'Editar venda' : 'Nova venda'}</h2>
          <div className="flex items-center gap-4">
            {!editing && (
              <button type="button" onClick={() => void repeatLast()} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">↻ Repetir última venda</button>
            )}
            <button type="button" onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">✕</button>
          </div>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className={label}>Plataforma</span>
                <div className="mt-1 inline-flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                  {CHANNELS.map((c) => (
                    <button key={c.value} type="button" onClick={() => changeChannel(c.value)} className={`rounded-md px-3 py-1.5 text-sm ${channel === c.value ? 'bg-white font-semibold shadow-sm dark:bg-slate-900' : 'text-slate-500 dark:text-slate-400'}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
                {channel === 'MERCADO_LIVRE' && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Tipo de anúncio</span>
                    <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                      {(['CLASSICO', 'PREMIUM'] as const).map((t) => (
                        <button key={t} type="button" aria-pressed={listingType === t} onClick={() => { setListingType(t); setFeeManual(null) }} className={`rounded-md px-2.5 py-1 text-xs ${listingType === t ? 'bg-white font-semibold shadow-sm dark:bg-slate-900' : 'text-slate-500 dark:text-slate-400'}`}>
                          {t === 'CLASSICO' ? 'Clássico' : 'Premium'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={label}>Data da venda<input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className={`${input} mt-1`} required /></label>
                <label className={label}>Comprador (opcional)<input value={buyer} onChange={(e) => setBuyer(e.target.value)} className={`${input} mt-1`} /></label>
              </div>
            </div>

            <div>
              <label className={label}>
                Produto
                <input
                  ref={searchRef}
                  value={product && !search ? product.productName : search}
                  onChange={(e) => { setSearch(e.target.value); if (product) { setProductId(''); setVariantKey('') } }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    // 1º Enter escolhe o primeiro resultado; com o produto já escolhido, Enter registra.
                    if (!product && results[0]) { e.preventDefault(); chooseProduct(results[0]) }
                  }}
                  placeholder="Digite para buscar e dê Enter"
                  autoComplete="off"
                  className={`${input} mt-1`}
                />
              </label>
              {!product && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {results.map((p) => {
                    const total = p.variants.reduce((s, v) => s + v.available, 0)
                    return (
                      <button key={p.productId} type="button" onClick={() => chooseProduct(p)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-left text-sm hover:border-violet-400 dark:border-slate-700">
                        <span className="font-medium">{p.productName}</span>
                        <span className="ml-2 text-xs text-slate-400">{p.variants.length > 0 ? `${total} em estoque` : 'sem estoque rastreado'}</span>
                      </button>
                    )
                  })}
                  {results.length === 0 && <span className="text-sm text-slate-400">Nenhum produto encontrado.</span>}
                </div>
              )}
            </div>

            {product && product.variants.length > 0 && (
              <div>
                <span className={label}>Variação (do estoque montado)</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {product.variants.map((v) => {
                    const short = quantityNum > v.available
                    const selected = v.key === variantKey
                    return (
                      <button key={v.key} type="button" onClick={() => setVariantKey(v.key)} aria-pressed={selected}
                        className={`rounded-lg border-2 px-3 py-2 text-left ${selected ? 'border-violet-600 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
                        {v.attrs.length > 0 ? <VariacaoPecas attrs={v.attrs} /> : <span className="text-sm">{v.label}</span>}
                        <span className={`mt-1 block text-xs font-medium ${short ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{v.available} em estoque</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className={label}>Quantidade<input value={quantity} onChange={(e) => setQuantity(e.target.value)} onFocus={(e) => e.target.select()} inputMode="numeric" className={`${input} mt-1`} /></label>
              <label className={label}>
                Valor unitário (R$)
                <input value={unitPrice} onChange={(e) => { touched.current.price = true; setUnitPrice(e.target.value) }} onFocus={(e) => e.target.select()} inputMode="decimal" className={`${input} mt-1`} />
                {listingPrice !== null && touched.current.price && Math.abs(priceNum - listingPrice) > 0.004 && (
                  <button type="button" onClick={() => { touched.current.price = false; setUnitPrice(listingPrice.toFixed(2)) }} className="mt-0.5 block text-left text-[11px] text-violet-600 hover:underline dark:text-violet-400">
                    anúncio: {money(listingPrice)} · usar o do anúncio
                  </button>
                )}
              </label>
              <label className={label}>Frete que você paga (R$)<input value={freight} onChange={(e) => { touched.current.freight = true; setFreight(e.target.value) }} onFocus={(e) => e.target.select()} inputMode="decimal" className={`${input} mt-1`} /></label>
              <label className={label}>
                Taxa da plataforma (R$)
                <input value={feeManual ?? auto.total.toFixed(2)} onChange={(e) => setFeeManual(e.target.value)} onFocus={(e) => e.target.select()} inputMode="decimal" className={`${input} mt-1`} />
                {feeManual !== null ? (
                  <button type="button" onClick={() => setFeeManual(null)} className="mt-0.5 block text-left text-[11px] text-violet-600 hover:underline dark:text-violet-400">
                    alterada (automático: {money(auto.total)}) · voltar ao automático
                  </button>
                ) : (
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {platform ? `${(auto.feePercent * 100).toFixed(0)}% + ${money(auto.feeFixed)} por unidade` : 'sem taxa na venda direta'}
                  </span>
                )}
              </label>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Embalagem</span>
              {packLines.length === 0 && <p className="mt-1 text-xs text-slate-400">Sem embalagem.</p>}
              <div className="mt-1 space-y-2">
                {packLines.map((l, i) => {
                  const item = packagingById.get(l.packagingItemId)
                  const need = (num(l.qpu) || 0) * quantityNum
                  const short = item && need > item.stock
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2">
                        <select value={l.packagingItemId} onChange={(e) => { touched.current.packaging = true; setPackLines((prev) => prev.map((x, j) => (j === i ? { ...x, packagingItemId: e.target.value } : x))) }} className={`${input} flex-1`}>
                          <option value="" disabled>Escolha a embalagem</option>
                          {packagingItems.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} · {p.stock} disp. · {money(p.unitCost)}</option>
                          ))}
                        </select>
                        <input value={l.qpu} onChange={(e) => { touched.current.packaging = true; setPackLines((prev) => prev.map((x, j) => (j === i ? { ...x, qpu: e.target.value } : x))) }} onFocus={(e) => e.target.select()} inputMode="decimal" aria-label="Quantidade por unidade" className={`${input} w-20 text-center`} />
                        <span className="text-xs text-slate-400">por un.</span>
                        <button type="button" onClick={() => { touched.current.packaging = true; setPackLines((prev) => prev.filter((_, j) => j !== i)) }} aria-label="Remover embalagem" className="text-slate-400 hover:text-red-600">✕</button>
                      </div>
                      {short && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">Estoque de {item.name}: {item.stock} disp., precisa de {need}. Não impede a venda.</p>}
                    </div>
                  )
                })}
              </div>
              <select value="" onChange={(e) => { if (!e.target.value) return; touched.current.packaging = true; setPackLines((prev) => [...prev, { packagingItemId: e.target.value, qpu: '1' }]) }} className={`${input} mt-2 w-auto`}>
                <option value="">+ Adicionar embalagem</option>
                {packagingItems.filter((p) => !packLines.some((l) => l.packagingItemId === p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Brinde</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={giftOn} onChange={(e) => { touched.current.gift = true; setGiftOn(e.target.checked) }} /> Com brinde
                </label>
                {giftOn && (
                  giftProducts.length === 0 ? <span className="text-xs text-slate-400">Nenhum brinde cadastrado.</span> : (
                    <>
                      <select value={giftProductId} onChange={(e) => { setGiftProductId(e.target.value); const g = giftProducts.find((x) => x.id === e.target.value); if (g) setGiftCost(String(g.unitCost)) }} className={`${input} w-auto`}>
                        {giftProducts.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                      <input value={giftQty} onChange={(e) => setGiftQty(e.target.value)} inputMode="numeric" aria-label="Quantidade do brinde" className={`${input} w-16 text-center`} />
                      <span className="text-xs text-slate-400">un. R$</span>
                      <input value={giftCost} onChange={(e) => setGiftCost(e.target.value)} inputMode="decimal" aria-label="Custo unitário do brinde" className={`${input} w-20 text-center`} />
                      <span className="text-xs text-slate-400">cada</span>
                    </>
                  )
                )}
              </div>
            </div>

            <label className={`${label} block`}>Observações (opcional)<input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${input} mt-1`} /></label>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
              {!product ? (
                <p className="text-sm text-slate-400">Escolha o produto para ver a conta do lucro.</p>
              ) : (
                <dl className="space-y-1.5 text-sm tabular-nums">
                  <div className="flex justify-between"><dt className="font-medium">Receita</dt><dd className="font-medium">{money(calc.revenue)}</dd></div>
                  <div className="flex justify-between text-slate-500 dark:text-slate-400"><dt>− Custo de produção ({quantityNum} × {money(product.productionCostPerUnit)})</dt><dd>{money(calc.production)}</dd></div>
                  <div className="flex justify-between text-slate-500 dark:text-slate-400"><dt>− Embalagem</dt><dd>{money(calc.packaging)}</dd></div>
                  <div className="flex justify-between text-slate-500 dark:text-slate-400"><dt>− Taxa da plataforma</dt><dd>{money(calc.fee)}</dd></div>
                  <div className="flex justify-between text-slate-500 dark:text-slate-400"><dt>− Frete</dt><dd>{money(calc.freight)}</dd></div>
                  <div className="flex justify-between text-slate-500 dark:text-slate-400"><dt>− Brinde</dt><dd>{money(calc.gift)}</dd></div>
                  <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
                    <dt className="font-semibold">Lucro</dt>
                    <dd className={`font-display text-lg font-semibold ${marginTone}`}>{money(calc.profit)}{calc.marginPct !== null && ` · ${calc.marginPct.toFixed(1)}%`}</dd>
                  </div>
                </dl>
              )}
              {product && calc.profit < 0 && <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">Esta venda dá prejuízo.</p>}
              {product && calc.profit >= 0 && calc.marginPct !== null && calc.marginPct < 20 && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Margem abaixo de 20%.</p>}
              {stockWarnings.length > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  Estoque de embalagem ficará negativo ({stockWarnings.map((w) => w.name).join(', ')}). Atualize em Meu Estoque.
                </p>
              )}
            </div>

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {disabledReason && product && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{disabledReason}</p>}

            <div className="mt-3 space-y-2">
              <button type="submit" disabled={busy || Boolean(disabledReason)} className="tk-btn-primary w-full py-2.5 text-sm disabled:opacity-50">
                {editing ? 'Salvar alterações' : 'Registrar venda'}
              </button>
              {!editing && (
                <button type="button" disabled={busy || Boolean(disabledReason)} onClick={() => void submit(true)} className="w-full rounded-lg border border-slate-300 py-2.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
                  Registrar e nova venda
                </button>
              )}
              <button type="button" onClick={onClose} className="w-full rounded-lg border border-slate-300 py-2.5 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">Cancelar</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Enter registra. Esc fecha.</p>
          </aside>
        </div>
      </form>
    </div>
  )
}
