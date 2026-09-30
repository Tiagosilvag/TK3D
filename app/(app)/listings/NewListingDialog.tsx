'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createListingDraft, getListingProductVariantOptions } from '@/actions/listings'
import { getMarketplacePlatformBadge, LISTING_TYPE_LABELS, formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import { ProductSelect } from '@/components/ProductSelect'
import type { ListingType } from '@prisma/client'

type Format = 'UNIDADE' | 'VARIACAO' | 'KIT'

const FORMAT_LABELS: Record<Format, string> = { UNIDADE: 'Unidade', VARIACAO: 'Variação', KIT: 'Kit' }
const LISTING_TYPE_OPTIONS = Object.keys(LISTING_TYPE_LABELS) as ListingType[]

function chipClass(active: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
  }`
}

// Anúncios: "+ Novo anúncio" (toolbar) e "+ Criar anúncio" (linha de um
// produto sem anúncio) abrem o mesmo <dialog> nativo -- só produto
// pré-selecionado muda entre os dois casos.
//
// Melhoria "Anúncios: Unidade/Variação/Kit": ganhou um seletor de formato
// no topo (chips) que troca os campos abaixo -- Unidade continua "1
// produto" de sempre; Variação pede o produto E quais combos de cor
// produzidos entram nesse anúncio específico (carregados sob demanda,
// getListingProductVariantOptions, só depois de escolher o produto);
// Kit troca o produto por um nome livre + lista de itens (produto +
// quantidade), com o custo total somado ao vivo no cliente (usa
// `products[].productionCost`, já calculado no servidor -- nenhum
// round-trip por item alterado). Cria já com preço/frete sugeridos
// (createListingDraft) quando dá (Unidade/Variação); Kit nasce com preço
// 0 pro vendedor definir, já que não tem 1 produto só pra basear sugestão.
export function NewListingDialog({
  products,
  platforms,
  presetProductId,
  trigger,
}: {
  products: { id: string; name: string; productionCost: number }[]
  platforms: { id: string; kind: 'SHOPEE' | 'MERCADO_LIVRE' }[]
  presetProductId?: string
  trigger: React.ReactNode
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [format, setFormat] = useState<Format>('UNIDADE')
  const [productId, setProductId] = useState(presetProductId ?? '')
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? '')
  const [listingType, setListingType] = useState<ListingType>('CLASSICO')
  const [error, setError] = useState<string | null>(null)

  const [variantOptions, setVariantOptions] = useState<{ key: string; label: string; colorHex: string | null }[] | null>(null)
  const [selectedVariantKeys, setSelectedVariantKeys] = useState<string[]>([])
  const [loadingVariants, setLoadingVariants] = useState(false)

  const [kitName, setKitName] = useState('')
  const [kitItems, setKitItems] = useState<{ productId: string; quantity: number }[]>([{ productId: presetProductId ?? '', quantity: 1 }])

  const selectedPlatform = platforms.find((p) => p.id === platformId)
  const isMl = selectedPlatform?.kind === 'MERCADO_LIVRE'

  async function loadVariants(id: string) {
    setSelectedVariantKeys([])
    if (!id) {
      setVariantOptions(null)
      return
    }
    setLoadingVariants(true)
    const options = await getListingProductVariantOptions(id)
    setVariantOptions(options)
    setLoadingVariants(false)
  }

  function handleProductChange(id: string) {
    setProductId(id)
    if (format === 'VARIACAO') void loadVariants(id)
  }

  function handleFormatChange(next: Format) {
    setFormat(next)
    setError(null)
    if (next === 'VARIACAO' && productId) void loadVariants(productId)
  }

  function toggleVariant(key: string) {
    setSelectedVariantKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  function updateKitItem(index: number, patch: Partial<{ productId: string; quantity: number }>) {
    setKitItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }
  function addKitItem() {
    setKitItems((prev) => [...prev, { productId: '', quantity: 1 }])
  }
  function removeKitItem(index: number) {
    setKitItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }
  const kitTotalCost = kitItems.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.productId)
    return sum + (product ? product.productionCost * item.quantity : 0)
  }, 0)

  function resetForm() {
    setFormat('UNIDADE')
    setProductId(presetProductId ?? '')
    setVariantOptions(null)
    setSelectedVariantKeys([])
    setKitName('')
    setKitItems([{ productId: presetProductId ?? '', quantity: 1 }])
    setError(null)
  }

  async function action() {
    if (!platformId) {
      setError('Selecione uma plataforma')
      return
    }
    if (format !== 'KIT' && !productId) {
      setError('Selecione um produto')
      return
    }
    if (format === 'VARIACAO' && selectedVariantKeys.length === 0) {
      setError('Marque pelo menos 1 variação pra incluir no anúncio')
      return
    }
    if (format === 'KIT') {
      if (!kitName.trim()) {
        setError('Informe o nome do kit')
        return
      }
      if (kitItems.some((i) => !i.productId)) {
        setError('Escolha o produto de cada item do kit')
        return
      }
    }

    const result = await createListingDraft({
      format,
      productId: format === 'KIT' ? null : productId,
      platformId,
      listingType: isMl ? listingType : null,
      includedVariantKeys: format === 'VARIACAO' ? selectedVariantKeys : undefined,
      kitName: format === 'KIT' ? kitName.trim() : null,
      kitItems: format === 'KIT' ? kitItems.filter((i) => i.productId) : undefined,
    })
    if (!result.success) {
      setError(result.error ?? 'Erro ao criar anúncio')
      return
    }
    setError(null)
    dialogRef.current?.close()
    router.refresh()
  }

  return (
    <>
      <span onClick={() => dialogRef.current?.showModal()}>{trigger}</span>
      <dialog
        ref={dialogRef}
        onClose={() => resetForm()}
        className="w-[26rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form action={action} className="grid grid-cols-1 gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Novo anúncio</h3>

          <div>
            <p className="mb-1 text-sm">Formato</p>
            <div className="flex gap-1.5">
              {(Object.keys(FORMAT_LABELS) as Format[]).map((f) => (
                <button key={f} type="button" onClick={() => handleFormatChange(f)} className={chipClass(format === f)}>
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          {format !== 'KIT' && !presetProductId && (
            <label className="text-sm">
              Produto *
              <ProductSelect options={products} value={productId} onChange={handleProductChange} className="tk-input-full" />
            </label>
          )}

          {format === 'VARIACAO' && productId && (
            <div>
              <p className="mb-1 text-sm">Variações incluídas neste anúncio *</p>
              {loadingVariants ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">Carregando…</p>
              ) : !variantOptions || variantOptions.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">Este produto ainda não tem nenhuma variação de cor produzida.</p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  {variantOptions.map((v) => (
                    <label key={v.key} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={selectedVariantKeys.includes(v.key)} onChange={() => toggleVariant(v.key)} />
                      {v.colorHex && <span style={{ background: v.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                      {v.label}
                    </label>
                  ))}
                </div>
              )}
              {selectedVariantKeys.length > 0 && (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{selectedVariantKeys.length} selecionada{selectedVariantKeys.length === 1 ? '' : 's'}</p>
              )}
            </div>
          )}

          {format === 'KIT' && (
            <>
              <label className="text-sm">
                Nome do kit *
                <input value={kitName} onChange={(e) => setKitName(e.target.value)} placeholder="Ex.: Kit Namorados" className="tk-input-full" />
              </label>
              <div>
                <p className="mb-1 text-sm">Itens do kit *</p>
                <div className="space-y-2">
                  {kitItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <ProductSelect options={products} value={item.productId} onChange={(id) => updateKitItem(i, { productId: id })} className="tk-input-full flex-1" />
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => updateKitItem(i, { quantity: Math.max(1, item.quantity - 1) })} className="tk-input h-8 w-8 shrink-0 text-center">−</button>
                        <span className="w-6 shrink-0 text-center text-sm tabular-nums">{item.quantity}</span>
                        <button type="button" onClick={() => updateKitItem(i, { quantity: item.quantity + 1 })} className="tk-input h-8 w-8 shrink-0 text-center">+</button>
                      </div>
                      {kitItems.length > 1 && (
                        <button type="button" onClick={() => removeKitItem(i)} className="tk-link-danger shrink-0 text-xs">Remover</button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addKitItem} className="mt-2 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">+ Adicionar item</button>
              </div>
              <p className="text-sm">
                Custo de produção do kit: <span className="font-semibold tabular-nums">{formatCurrency(kitTotalCost)}</span>{' '}
                <span title="Soma automática: quantidade × custo unitário de cada item" className="text-xs text-slate-400">Σ</span>
              </p>
            </>
          )}

          <label className="text-sm">
            Plataforma *
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} required className="tk-input-full">
              {platforms.map((p) => <option key={p.id} value={p.id}>{getMarketplacePlatformBadge(p.kind).label}</option>)}
            </select>
          </label>
          {isMl && (
            <label className="text-sm">
              Tipo de anúncio
              <select value={listingType} onChange={(e) => setListingType(e.target.value as ListingType)} className="tk-input-full">
                {LISTING_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{LISTING_TYPE_LABELS[t]}</option>)}
              </select>
            </label>
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <SubmitButton pendingLabel="Criando…">Criar anúncio</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
