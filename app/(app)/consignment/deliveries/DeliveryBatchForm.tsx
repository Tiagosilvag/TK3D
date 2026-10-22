'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createConsignmentDeliveryBatch, getLastConsignmentDeliveryItems, getPartnerHoldings, deleteConsignmentDeliveryBatch } from '@/actions/consignmentDeliveries'
import { UndoToast } from '@/components/UndoToast'
import { formatCurrency } from '@/lib/format'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { SubmitButton } from '@/components/SubmitButton'
import type { VariantAttr } from '@/lib/reports'

export interface PartnerOption {
  id: string
  name: string
  defaultCommissionPercent: number
}

export interface ProductVariantOption {
  key: string
  label: string
  colorHex: string | null
  available: number
  attrs: VariantAttr[]
}

export interface ProductOption {
  productId: string
  productName: string
  suggestedPrice: number | null
  // Melhoria "Registrar entrega §2/§3": custo de produção ao vivo, pro
  // rodapé "custo de produção"/"lucro estimado" -- ver page.tsx
  // (getProductAverageProductionCost, mesmo padrão já usado em
  // getConsignmentPartnerDetail pro card "Resultado das vendas").
  unitCost: number
  variants: ProductVariantOption[]
}

const NO_VARIANT_KEY = '__none__'

interface DeliveryLine {
  variantKey: string | null
  label: string
  colorHex: string | null
  quantity: number
}

function lineKey(productId: string, variantKey: string | null): string {
  return `${productId}::${variantKey ?? NO_VARIANT_KEY}`
}

// Pedido "nomes de variação curtos": "Rosa pink · Dourado" em vez de
// "ARGOLA — DOURADO, ELO — DOURADO, ROSA PINK" -- attrs[].shortValue já é
// só o(s) nome(s) de cor sem marca/nome de peça (lib/reports.ts), junta
// com " · " em vez do `label` longo que as outras telas usam.
function compactVariantLabel(v: ProductVariantOption): string {
  if (v.attrs.length === 0) return v.label
  return v.attrs.map((a) => a.shortValue).join(' · ')
}

function yesterdayString(): string {
  const d = new Date(today())
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Pedido "nome da variação em 2 níveis, sem cortar": título em destaque (1º
// attr, maior hierarquia -- tier "produto" sempre vem primeiro, ver
// VARIANT_ATTR_TIER_RANK em lib/reports.ts) + detalhe embaixo com o resto,
// em vez da única linha corrida que `compactVariantLabel` gerava (cortava
// com `truncate` quando a peça tinha muitos componentes).
function variantTitleAndDetail(v: ProductVariantOption): { title: string; detail: string } {
  if (v.attrs.length === 0) return { title: v.label, detail: '' }
  const [first, ...rest] = v.attrs
  return { title: first.shortValue, detail: rest.map((a) => a.shortValue).join(' · ') }
}

function totalAvailable(p: ProductOption): number {
  return p.variants.reduce((s, v) => s + v.available, 0)
}

// Produto sem NENHUMA variante cadastrada (nunca produzido/montado em
// nenhuma cor -- caso raro, legado) não entra no agrupamento "esgotado":
// não há como saber se ele tem estoque ou não, então fica sempre na lista
// principal com quantidade livre (mesmo comportamento de sempre).
function isOutOfStock(p: ProductOption): boolean {
  return p.variants.length > 0 && totalAvailable(p) === 0
}

// Selo de estoque por variante -- verde normalmente, âmbar quando resta
// pouco (≤ 2) ou quando a quantidade já escolhida nesta entrega bateu no
// máximo disponível (mesmo aviso visual que Montagem/Pedidos já usam pra
// "não dá pra pedir mais disso").
function StockBadge({ available, selected }: { available: number; selected: number }) {
  const low = available <= 2 || selected >= available
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
        low
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
      }`}
    >
      {available} disp.
    </span>
  )
}

function QtyStepper({
  value,
  onDec,
  onInc,
  incDisabled,
  onSet,
}: {
  value: number
  onDec: () => void
  onInc: () => void
  incDisabled: boolean
  // Digitar a quantidade direto (limitada ao saldo por quem chama).
  onSet: (n: number) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onDec}
        disabled={value <= 0}
        aria-label="Diminuir"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-30 dark:border-slate-600 dark:text-slate-300"
      >
        −
      </button>
      <input value={value} onChange={(e) => onSet(Math.floor(Number(e.target.value.replace(/\D/g, ''))) || 0)} onFocus={(e) => e.target.select()} inputMode="numeric" aria-label="Quantidade" className="w-9 rounded border border-transparent bg-transparent text-center text-sm font-medium tabular-nums hover:border-slate-300 focus:border-violet-400 focus:outline-none dark:hover:border-slate-600" />
      <button
        type="button"
        onClick={onInc}
        disabled={incDisabled}
        aria-label="Aumentar"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-violet-400 text-violet-600 disabled:opacity-30 dark:border-violet-500 dark:text-violet-400"
      >
        +
      </button>
    </div>
  )
}

// Redesign "Registrar entrega §2": o fluxo antigo (Adicionar produto →
// escolher variante → digitar quantidade/preço → "Adicionar à entrega" →
// voltar, repetir por produto) levava ~40 cliques/digitações pra uma
// entrega de 10 produtos. Vira tela única de 2 colunas: esquerda lista
// TODOS os produtos com estoque (−/+ direto na linha, sem botão
// "adicionar" -- mexer no contador já reflete na entrega), direita mostra
// ao vivo o que foi montado, com chips removíveis por variante e preço
// ajustável por produto (um valor só, vale pra todas as cores dele).
export function DeliveryBatchForm({
  open,
  onOpenChange,
  partners,
  products,
  defaultProductId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  partners: PartnerOption[]
  products: ProductOption[]
  // 2.2: link de ação rápida "Entregar a parceiro" em /stock chega aqui
  // com ?productId=... -- abre o modal com esse produto já expandido.
  defaultProductId?: string
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [partnerId, setPartnerId] = useState('')
  const [dateMode, setDateMode] = useState<'hoje' | 'ontem' | 'outra'>('hoje')
  const [deliveryDate, setDeliveryDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedProductId, setExpandedProductId] = useState<string | null>(defaultProductId ?? null)
  const [showOutOfStock, setShowOutOfStock] = useState(false)
  const [showEsgotadasFor, setShowEsgotadasFor] = useState<Set<string>>(new Set())
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [repeating, setRepeating] = useState(false)
  const [error, setError] = useState('')
  const [holdings, setHoldings] = useState<{ productId: string; colorComboKey: string | null; remaining: number }[]>([])
  const [toast, setToast] = useState<{ message: string; batchId: string } | null>(null)

  const productById = useMemo(() => new Map(products.map((p) => [p.productId, p])), [products])
  const selectedPartner = partners.find((p) => p.id === partnerId) ?? null

  // O que ela já tem: base do aviso "vai somar na mesma linha".
  useEffect(() => {
    let cancelled = false
    if (!partnerId) { setHoldings([]); return }
    void getPartnerHoldings(partnerId).then((h) => { if (!cancelled) setHoldings(h) })
    return () => { cancelled = true }
  }, [partnerId])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (open) setExpandedProductId(defaultProductId ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na abertura inicial
  }, [open, defaultProductId])

  function resetAll() {
    setPartnerId('')
    setDateMode('hoje')
    setDeliveryDate(today())
    setNotes('')
    setNotesOpen(false)
    setSearch('')
    setExpandedProductId(null)
    setQuantities({})
    setPrices({})
    setError('')
  }

  function setQty(productId: string, variantKey: string | null, next: number, available: number | null) {
    const clamped = available == null ? Math.max(0, next) : Math.max(0, Math.min(available, next))
    const key = lineKey(productId, variantKey)
    setQuantities((prev) => {
      if (clamped === 0) {
        const { [key]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [key]: clamped }
    })
    if (clamped > 0) {
      setPrices((prev) => {
        if (prev[productId] !== undefined) return prev
        const product = productById.get(productId)
        return { ...prev, [productId]: product?.suggestedPrice ?? 0 }
      })
    }
  }

  function adjustPrice(productId: string, delta: number) {
    setPrices((prev) => {
      const current = prev[productId] ?? productById.get(productId)?.suggestedPrice ?? 0
      return { ...prev, [productId]: Math.max(0, Math.round((current + delta) * 100) / 100) }
    })
  }

  function handleDateChip(mode: 'hoje' | 'ontem' | 'outra') {
    setDateMode(mode)
    if (mode === 'hoje') setDeliveryDate(today())
    if (mode === 'ontem') setDeliveryDate(yesterdayString())
  }

  function handleClear() {
    setQuantities({})
    setPrices({})
    setError('')
  }

  // "Entregar tudo disponível": todas as variações com estoque livre.
  function handleDeliverAll() {
    const next: Record<string, number> = {}
    for (const p of products) {
      for (const v of p.variants) if (v.available > 0) next[lineKey(p.productId, v.key)] = v.available
    }
    setQuantities(next)
    setPrices((prev) => {
      const out = { ...prev }
      for (const p of products) if (out[p.productId] === undefined && p.variants.some((v) => v.available > 0)) out[p.productId] = p.suggestedPrice ?? 0
      return out
    })
    setError('')
  }

  async function handleRepeatLast() {
    if (!partnerId) {
      setError('Selecione um parceiro primeiro')
      return
    }
    setRepeating(true)
    setError('')
    try {
      const items = await getLastConsignmentDeliveryItems(partnerId)
      if (items.length === 0) {
        setError('Esse parceiro ainda não tem nenhuma entrega anterior')
        return
      }
      const newQuantities: Record<string, number> = {}
      const newPrices: Record<string, number> = {}
      for (const item of items) {
        const product = productById.get(item.productId)
        if (!product) continue
        if (item.colorComboKey === null) {
          newQuantities[lineKey(item.productId, null)] = item.quantity
        } else {
          const variant = product.variants.find((v) => v.key === item.colorComboKey)
          if (!variant || variant.available <= 0) continue
          const qty = Math.min(item.quantity, variant.available)
          if (qty <= 0) continue
          newQuantities[lineKey(item.productId, item.colorComboKey)] = qty
        }
        if (newPrices[item.productId] === undefined) newPrices[item.productId] = item.unitPrice
      }
      setQuantities(newQuantities)
      setPrices(newPrices)
    } finally {
      setRepeating(false)
    }
  }

  // Itens da entrega agrupados por produto (pra renderizar 1 card por
  // produto na coluna direita, com chip por variante).
  const itemsByProduct = useMemo(() => {
    const map = new Map<string, DeliveryLine[]>()
    for (const [key, quantity] of Object.entries(quantities)) {
      if (quantity <= 0) continue
      const sep = key.lastIndexOf('::')
      const productId = key.slice(0, sep)
      const rawVariantKey = key.slice(sep + 2)
      const variantKey = rawVariantKey === NO_VARIANT_KEY ? null : rawVariantKey
      const product = productById.get(productId)
      if (!product) continue
      const variant = variantKey ? product.variants.find((v) => v.key === variantKey) : undefined
      const list = map.get(productId) ?? []
      list.push({
        variantKey,
        label: variant ? compactVariantLabel(variant) : product.productName,
        colorHex: variant?.colorHex ?? null,
        quantity,
      })
      map.set(productId, list)
    }
    return [...map.entries()].map(([productId, lines]) => ({ product: productById.get(productId)!, lines }))
  }, [quantities, productById])

  const totalUnits = itemsByProduct.reduce((sum, { lines }) => sum + lines.reduce((s, l) => s + l.quantity, 0), 0)
  const totalValue = itemsByProduct.reduce((sum, { product, lines }) => {
    const price = prices[product.productId] ?? product.suggestedPrice ?? 0
    return sum + lines.reduce((s, l) => s + l.quantity * price, 0)
  }, 0)
  const totalCost = itemsByProduct.reduce((sum, { product, lines }) => sum + lines.reduce((s, l) => s + l.quantity * product.unitCost, 0), 0)
  const estimatedProfit = selectedPartner ? totalValue * (1 - selectedPartner.defaultCommissionPercent) - totalCost : null

  // Variações que ela já tem e que esta entrega vai somar: antes → depois.
  const mergeNotices = itemsByProduct.flatMap(({ product, lines }) =>
    lines.flatMap((l) => {
      const have = holdings.find((h) => h.productId === product.productId && (h.colorComboKey ?? null) === l.variantKey)?.remaining ?? 0
      if (have <= 0) return []
      const variant = l.variantKey ? product.variants.find((v) => v.key === l.variantKey) : undefined
      const name = variant ? `${product.productName} (${compactVariantLabel(variant)})` : product.productName
      return [{ key: `${product.productId}::${l.variantKey}`, text: `${name}: ${have} → ${have + l.quantity}` }]
    }),
  )

  const dateLabel = dateMode === 'hoje' ? 'hoje' : dateMode === 'ontem' ? 'ontem' : new Date(deliveryDate).toLocaleDateString('pt-BR')

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term ? products.filter((p) => p.productName.toLowerCase().includes(term)) : products
  }, [products, search])
  const inStockProducts = useMemo(() => filteredProducts.filter((p) => !isOutOfStock(p)), [filteredProducts])
  const outOfStockProducts = useMemo(() => filteredProducts.filter(isOutOfStock), [filteredProducts])

  async function action() {
    if (!partnerId) {
      setError('Selecione um parceiro')
      return
    }
    if (itemsByProduct.length === 0) {
      setError('Adicione pelo menos um produto')
      return
    }
    for (const { product } of itemsByProduct) {
      const price = prices[product.productId] ?? 0
      if (!Number.isFinite(price) || price <= 0) {
        setError(`Preço inválido para "${product.productName}"`)
        return
      }
    }
    setError('')

    const fd = new FormData()
    fd.set('partnerId', partnerId)
    fd.set('deliveryDate', deliveryDate)
    fd.set('notes', notes)
    fd.set(
      'itemsJson',
      JSON.stringify(
        itemsByProduct.flatMap(({ product, lines }) =>
          lines.map((l) => ({
            productId: product.productId,
            colorComboKey: l.variantKey,
            quantityDelivered: l.quantity,
            unitPrice: prices[product.productId] ?? 0,
          })),
        ),
      ),
    )
    const result = await createConsignmentDeliveryBatch(fd)
    if (!result.success) {
      setError(result.error ?? 'Erro ao registrar entrega')
      return
    }
    onOpenChange(false)
    resetAll()
    if (result.batchId) setToast({ message: 'Entrega registrada.', batchId: result.batchId })
    router.refresh()
  }

  async function undoDelivery() {
    const t = toast
    setToast(null)
    if (!t) return
    await deleteConsignmentDeliveryBatch(t.batchId)
    router.refresh()
  }

  return (
    <>
    {toast && <UndoToast message={toast.message} onUndo={() => void undoDelivery()} onDismiss={() => setToast(null)} durationMs={10000} />}
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetAll() }}
      className="w-full [--tk-dialog-cap:34rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 lg:[--tk-dialog-cap:60rem]"
    >
      <form action={action} className="grid grid-cols-1 gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Registrar entrega</h3>
          <button type="button" onClick={() => { onOpenChange(false); resetAll() }} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Parceiro</p>
            <div className="flex flex-wrap gap-1.5">
              {partners.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPartnerId(p.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    partnerId === p.id
                      ? 'bg-violet-600 text-white'
                      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Data da entrega</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['hoje', 'ontem'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleDateChip(mode)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                    dateMode === mode
                      ? 'bg-violet-600 text-white'
                      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {mode}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleDateChip('outra')}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  dateMode === 'outra'
                    ? 'bg-violet-600 text-white'
                    : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                Outra data…
              </button>
              {dateMode === 'outra' && (
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="tk-input w-36"
                  required
                />
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Produtos em estoque</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">Use − / + direto na linha · sem botão &quot;adicionar&quot;</p>
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produto…"
              className="tk-input-full mt-2"
            />
            {/* Pedido "priorizar o que tem estoque (esconder o esgotado)":
                produto com estoque total 0 (em TODAS as cores, nunca o caso
                "sem variação cadastrada" -- esse não tem como saber se tem
                estoque, fica sempre na lista principal) sai da lista e vai
                pro grupo recolhido no fim, separado da rolagem principal. */}
            <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
              {inStockProducts.length} {inStockProducts.length === 1 ? 'produto' : 'produtos'} com estoque
              {outOfStockProducts.length > 0 && ` · ${outOfStockProducts.length} esgotado${outOfStockProducts.length > 1 ? 's' : ''}${showOutOfStock ? '' : ' (ocultos)'}`}
            </p>
            <div className="mt-2 max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {inStockProducts.length === 0 && outOfStockProducts.length === 0 && (
                <p className="px-2 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum produto encontrado.</p>
              )}
              {inStockProducts.map((product) => {
                // Pedido "dentro de um produto, mostrar só as variações com
                // estoque": esgotadas ficam atrás de "Mostrar N esgotadas"
                // dentro do próprio produto, apagadas e sem −/+ (nunca dá
                // pra entregar o que não existe).
                const variantsInStock = product.variants.filter((v) => v.available > 0)
                const variantsOut = product.variants.filter((v) => v.available === 0)
                const addedForProduct = product.variants.reduce((s, v) => s + (quantities[lineKey(product.productId, v.key)] ?? 0), 0)
                  + (quantities[lineKey(product.productId, null)] ?? 0)
                const noVariantTracking = product.variants.length === 0
                // "1 variação só" (inline, sem expandir) exige não ter
                // NENHUMA esgotada escondida também -- senão não haveria
                // como ver o aviso "+N esgotadas".
                const singleVariant = variantsInStock.length === 1 && variantsOut.length === 0 ? variantsInStock[0] : null
                const multiVariant = !singleVariant && !noVariantTracking
                const isExpanded = expandedProductId === product.productId
                const showEsgotadas = showEsgotadasFor.has(product.productId)

                return (
                  <div key={product.productId} className="rounded-lg border border-slate-200 dark:border-slate-700">
                    <div
                      role={multiVariant ? 'button' : undefined}
                      tabIndex={multiVariant ? 0 : undefined}
                      onClick={multiVariant ? () => setExpandedProductId(isExpanded ? null : product.productId) : undefined}
                      className={`flex items-center justify-between gap-2 px-3 py-2 ${multiVariant ? 'cursor-pointer' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                          {product.productName}
                          {addedForProduct > 0 && (
                            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                              {addedForProduct}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          {noVariantTracking
                            ? 'sem variação cadastrada'
                            : `${variantsInStock.length} ${variantsInStock.length === 1 ? 'variação' : 'variações'} com estoque · ${variantsInStock.reduce((s, v) => s + v.available, 0)} un${variantsOut.length > 0 ? ` · +${variantsOut.length} esgotada${variantsOut.length > 1 ? 's' : ''}` : ''}`}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                        {product.suggestedPrice != null ? formatCurrency(product.suggestedPrice) : '—'}
                      </span>
                      {singleVariant && (
                        <>
                          <StockBadge available={singleVariant.available} selected={quantities[lineKey(product.productId, singleVariant.key)] ?? 0} />
                          <QtyStepper
                            value={quantities[lineKey(product.productId, singleVariant.key)] ?? 0}
                            onDec={() => setQty(product.productId, singleVariant.key, (quantities[lineKey(product.productId, singleVariant.key)] ?? 0) - 1, singleVariant.available)}
                            onInc={() => setQty(product.productId, singleVariant.key, (quantities[lineKey(product.productId, singleVariant.key)] ?? 0) + 1, singleVariant.available)}
                            incDisabled={(quantities[lineKey(product.productId, singleVariant.key)] ?? 0) >= singleVariant.available}
                            onSet={(n) => setQty(product.productId, singleVariant.key, n, singleVariant.available)}
                          />
                        </>
                      )}
                      {noVariantTracking && (
                        <QtyStepper
                          value={quantities[lineKey(product.productId, null)] ?? 0}
                          onDec={() => setQty(product.productId, null, (quantities[lineKey(product.productId, null)] ?? 0) - 1, null)}
                          onInc={() => setQty(product.productId, null, (quantities[lineKey(product.productId, null)] ?? 0) + 1, null)}
                          incDisabled={false}
                          onSet={(n) => setQty(product.productId, null, n, null)}
                        />
                      )}
                      {multiVariant && <span aria-hidden className="shrink-0 text-slate-400">{isExpanded ? '▴' : '▾'}</span>}
                    </div>

                    {multiVariant && isExpanded && (
                      <div className="space-y-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                        {variantsInStock.map((v) => {
                          const { title, detail } = variantTitleAndDetail(v)
                          return (
                            <div key={v.key} className="flex items-center justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  {v.colorHex && <span style={{ background: v.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
                                </div>
                                {detail && <p className="text-xs text-slate-400 dark:text-slate-500">{detail}</p>}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <StockBadge available={v.available} selected={quantities[lineKey(product.productId, v.key)] ?? 0} />
                                <QtyStepper
                                  value={quantities[lineKey(product.productId, v.key)] ?? 0}
                                  onDec={() => setQty(product.productId, v.key, (quantities[lineKey(product.productId, v.key)] ?? 0) - 1, v.available)}
                                  onInc={() => setQty(product.productId, v.key, (quantities[lineKey(product.productId, v.key)] ?? 0) + 1, v.available)}
                                  incDisabled={(quantities[lineKey(product.productId, v.key)] ?? 0) >= v.available}
                                  onSet={(n) => setQty(product.productId, v.key, n, v.available)}
                                />
                              </div>
                            </div>
                          )
                        })}

                        {variantsOut.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setShowEsgotadasFor((prev) => {
                                const next = new Set(prev)
                                if (next.has(product.productId)) next.delete(product.productId)
                                else next.add(product.productId)
                                return next
                              })}
                              className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                            >
                              {showEsgotadas ? '▴ Ocultar esgotadas' : `▾ Mostrar ${variantsOut.length} esgotada${variantsOut.length > 1 ? 's' : ''}`}
                            </button>
                            {showEsgotadas && variantsOut.map((v) => {
                              const { title, detail } = variantTitleAndDetail(v)
                              return (
                                <div key={v.key} className="flex items-center justify-between gap-3 opacity-50">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      {v.colorHex && <span style={{ background: v.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</p>
                                    </div>
                                    {detail && <p className="text-xs text-slate-400 dark:text-slate-500">{detail}</p>}
                                  </div>
                                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                    esgotado
                                  </span>
                                </div>
                              )
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {outOfStockProducts.length > 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setShowOutOfStock((s) => !s)}
                    className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400"
                  >
                    <span>Sem estoque · {outOfStockProducts.length} {outOfStockProducts.length === 1 ? 'produto' : 'produtos'}</span>
                    <span aria-hidden>{showOutOfStock ? '▴ Ocultar' : '▾ Mostrar'}</span>
                  </button>
                  {showOutOfStock && (
                    <div className="space-y-1 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                      {outOfStockProducts.map((p) => (
                        <div key={p.productId} className="flex items-center justify-between gap-2 py-1 opacity-50">
                          <span className="text-sm text-slate-500 dark:text-slate-400">{p.productName}</span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">esgotado</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Itens desta entrega</p>
              <div className="flex items-center gap-3 text-xs font-medium">
                <button type="button" onClick={() => void handleRepeatLast()} disabled={repeating} className="text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400">
                  {repeating ? 'Carregando…' : '↻ Repetir última entrega'}
                </button>
                <button type="button" onClick={handleDeliverAll} className="text-violet-600 hover:underline dark:text-violet-400">Entregar tudo disponível</button>
                {itemsByProduct.length > 0 && (
                  <button type="button" onClick={handleClear} className="text-red-600 hover:underline dark:text-red-400">
                    Limpar
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2 max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {itemsByProduct.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum produto adicionado ainda.</p>
              ) : (
                itemsByProduct.map(({ product, lines }) => {
                  const price = prices[product.productId] ?? product.suggestedPrice ?? 0
                  const productQty = lines.reduce((s, l) => s + l.quantity, 0)
                  const subtotal = productQty * price
                  return (
                    <div key={product.productId} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{product.productName}</p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(subtotal)}</p>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {lines.map((l) => (
                          <span key={l.variantKey ?? NO_VARIANT_KEY} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs dark:border-slate-700">
                            {l.colorHex && <span style={{ background: l.colorHex }} className="inline-block h-2 w-2 shrink-0 rounded-full" />}
                            {l.label} ×{l.quantity}
                            <button
                              type="button"
                              onClick={() => setQty(product.productId, l.variantKey, 0, null)}
                              aria-label="Remover"
                              className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>{productQty} un × valor un.</span>
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => adjustPrice(product.productId, -1)} aria-label="Diminuir preço" className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300">−</button>
                          <span className="w-16 text-center text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(price)}</span>
                          <button type="button" onClick={() => adjustPrice(product.productId, 1)} aria-label="Aumentar preço" className="flex h-6 w-6 items-center justify-center rounded-full border border-violet-400 text-violet-600 dark:border-violet-500 dark:text-violet-400">+</button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {selectedPartner ? selectedPartner.name : 'Selecione um parceiro'} · {totalUnits} {totalUnits === 1 ? 'peça' : 'peças'} · {itemsByProduct.length} {itemsByProduct.length === 1 ? 'produto' : 'produtos'} · {dateLabel}
          </p>
          <div className="text-right">
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(totalValue)}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">custo de produção {formatCurrency(totalCost)}</p>
            {estimatedProfit != null && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                lucro após comissão {(selectedPartner!.defaultCommissionPercent * 100).toFixed(0)}%: {formatCurrency(estimatedProfit)}
              </p>
            )}
          </div>
        </div>

        {mergeNotices.length > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <p className="font-medium">Já estão com ela e vão somar na mesma linha:</p>
            <ul className="mt-0.5 list-disc pl-4">{mergeNotices.map((n) => <li key={n.key}>{n.text}</li>)}</ul>
          </div>
        )}

        {notesOpen ? (
          <label className="text-sm">
            Observações (opcional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="tk-input-full" rows={2} autoFocus />
          </label>
        ) : (
          <button type="button" onClick={() => setNotesOpen(true)} className="self-start text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
            + Observação (opcional)
          </button>
        )}

        <div className="mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => { onOpenChange(false); resetAll() }} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
          <SubmitButton pendingLabel="Salvando…" disabled={!partnerId || itemsByProduct.length === 0}>Registrar entrega</SubmitButton>
        </div>
      </form>
    </dialog>
    </>
  )
}
