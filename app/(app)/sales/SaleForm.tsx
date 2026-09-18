'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSaleBatch, updateSale } from '@/actions/sales'
import { getPlatformSalePrice } from '@/actions/marketplacePlatforms'
import { SubmitButton } from '@/components/SubmitButton'
import { formatCurrency } from '@/lib/format'
import { resolveTieredPlatformFee, type PlatformFeeTier } from '@/lib/costing'
import type { MarketplacePlatformKind } from '@prisma/client'

// Melhoria "Mostrar taxa da plataforma": ao lado do Valor unitário, mostra
// quanto da taxa Shopee/Mercado Livre entrou no preço sugerido -- resolvido
// junto com o prefill (getPlatformSalePrice já devolve o breakdown, não só
// o preço), pra tirar a dúvida "a taxa está indo?" sem precisar abrir
// Configurações ou fazer conta de cabeça.
const PLATFORM_LABELS: Record<string, string> = { SHOPEE: 'Shopee', MERCADO_LIVRE: 'Mercado Livre' }

// Melhoria "Vendas por variante": cada produto ativo já vem com suas
// variantes de cor em estoque (getProductVariantStockOptions, lib/reports.ts)
// -- mesmo shape que DeliveryBatchForm.ProductOption já usa pra Entregas,
// só que aqui "available" também desconta venda direta, não só entrega.
export interface ProductVariantOption {
  key: string
  label: string
  colorHex: string | null
  available: number
}

export interface ProductOption {
  productId: string
  productName: string
  variants: ProductVariantOption[]
  // Melhoria "Redesign Vendas" §3: custo unitário do produto (mesmo valor
  // de getProductCostBreakdown().finalCost, calculado uma vez em
  // sales/page.tsx) -- não varia por cor/variação (o custeio não
  // diferencia por cor), usado só pro bloco "Custo de produção" da prévia
  // ao vivo abaixo.
  unitCost: number
}

// Melhoria "Redesign Vendas" §1/§4: taxa cadastrada de cada plataforma
// (mesmo formato PlatformFeeTier[] usado em Configurações/Produtos),
// passada pronta de sales/page.tsx -- alimenta a prévia ao vivo (3, cálculo
// client-side puro, sem round-trip a cada campo mudado) e o painel "Taxas
// cadastradas" (4).
export interface PlatformFeeInfo {
  kind: MarketplacePlatformKind
  feePercent: number
  feeFixed: number
  feeTiers: PlatformFeeTier[] | null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// 3.6: plataforma específica obrigatória -- "Marketplace" genérico saiu da
// lista de opções pra venda nova (só existe em vendas já registradas antes
// dessa mudança, ver EditingSale abaixo).
const CHANNELS = [
  { value: 'DIRETA', label: 'Direta' },
  { value: 'SHOPEE', label: 'Shopee' },
  { value: 'MERCADO_LIVRE', label: 'Mercado Livre' },
]

type EditingSale = {
  id: string
  channel: string
  productId: string
  quantity: number
  unitPrice: number
  saleDate: string
  buyerOrPlatform: string | null
  notes: string | null
  colorComboKey: string | null
}

// Melhoria "Vendas: múltiplos produtos numa venda": item já confirmado na
// lista (denormaliza nome/cor pra exibir sem precisar procurar de novo em
// `products`) -- mesmo padrão de DeliveryBatchForm.tsx#ItemDraft.
interface ItemDraft {
  productId: string
  productName: string
  colorComboKey: string | null
  colorLabel: string | null
  colorHex: string | null
  quantity: number
  unitPrice: number
}

// Formato "de fio" (o que createSaleBatch espera por item) -- usado tanto
// pra serializar `items` no submit quanto pra somar o item em rascunho
// (ainda não confirmado na lista) na prévia ao vivo.
type WireItem = { productId: string; quantity: number; unitPrice: number; colorComboKey: string | null }

// Melhoria "Redesign Vendas" §3: mesma resolução de faixa que
// resolveSalePlatformFee (actions/marketplacePlatforms.ts) faz no
// servidor pra congelar o costSnapshot -- reimplementada aqui como cálculo
// client-side puro (resolveTieredPlatformFee é uma função pura de
// lib/costing.ts, sem 'use server') pra recalcular a cada campo mudado sem
// round-trip. `price` é o unitPrice JÁ DIGITADO (não o preço sugerido),
// mesmo raciocínio de resolveSalePlatformFee: aqui não tem gross-up, só
// achar a faixa certa pro preço que a venda vai ter de verdade.
function resolvePlatformFeeForPrice(platform: PlatformFeeInfo, price: number): { feePercent: number; feeFixed: number } {
  if (platform.feeTiers && platform.feeTiers.length > 0) return resolveTieredPlatformFee(platform.feeTiers, price)
  return { feePercent: platform.feePercent, feeFixed: platform.feeFixed }
}

export function SaleForm({
  products,
  platforms,
  editingSale,
  defaultProductId,
}: {
  products: ProductOption[]
  platforms: PlatformFeeInfo[]
  editingSale?: EditingSale
  // 2.2: link de ação rápida "Registrar venda direta" em /stock chega aqui
  // com ?productId=... pra pré-selecionar o produto.
  defaultProductId?: string
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [channel, setChannel] = useState(editingSale?.channel ?? '')
  const [unitPrice, setUnitPrice] = useState(editingSale ? String(editingSale.unitPrice) : '')
  const [quantity, setQuantity] = useState(editingSale ? String(editingSale.quantity) : '1')
  const [prefilling, setPrefilling] = useState(false)
  const [productId, setProductId] = useState(editingSale?.productId ?? defaultProductId ?? '')
  const [colorComboKey, setColorComboKey] = useState(editingSale?.colorComboKey ?? '')
  // Melhoria "Vendas: múltiplos produtos numa venda": só usado no modo
  // "nova venda" (editingSale editar continua 1 item só, sem esta lista) --
  // cada "+ Adicionar produto" empurra o rascunho atual pra aqui e limpa os
  // campos Produto/Cor/Quantidade/Valor unitário pro próximo.
  const [items, setItems] = useState<ItemDraft[]>([])

  const selectedProduct = useMemo(() => products.find((p) => p.productId === productId), [products, productId])

  // Melhoria "Vendas por variante": mesma UX de DeliveryBatchForm -- venda
  // de um produto com mais de uma cor em estoque exige escolher qual foi
  // vendida (sem isso, "Meu Estoque" não consegue descontar a cor certa).
  // Produto sem variante conhecida (getProductVariantBreakdown não achou
  // nenhuma) não pede cor -- mesma convenção de Entregas.
  const requiresColorChoice = Boolean(selectedProduct && selectedProduct.variants.length > 0)

  const quantityNum = Number(quantity) || 0
  const unitPriceNum = Number(unitPrice) || 0

  // Melhoria "Vendas: múltiplos produtos numa venda": o item em rascunho
  // (campos Produto/Cor/Quantidade/Valor unitário ainda não confirmados via
  // "+ Adicionar produto") só entra na conta quando está completo -- assim
  // uma venda de 1 produto só continua funcionando sem precisar clicar
  // "+ Adicionar produto" nenhuma vez (mesma UX de sempre), e um 2º+
  // produto em edição soma na prévia antes mesmo de confirmado.
  const draftItem: WireItem | null = useMemo(() => {
    if (!productId || quantityNum <= 0 || unitPriceNum <= 0) return null
    if (requiresColorChoice && !colorComboKey) return null
    return { productId, quantity: quantityNum, unitPrice: unitPriceNum, colorComboKey: colorComboKey || null }
  }, [productId, quantityNum, unitPriceNum, requiresColorChoice, colorComboKey])

  const previewItems: WireItem[] = useMemo(() => {
    const committed = items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, colorComboKey: i.colorComboKey }))
    return draftItem ? [...committed, draftItem] : committed
  }, [items, draftItem])

  // Melhoria "Redesign Vendas" §3 (estendida pra múltiplos produtos): os 3
  // blocos somam Custo/Taxa/Lucro de TODOS os itens já adicionados + o
  // rascunho em edição -- recalcula a cada item adicionado/removido ou
  // campo do rascunho mudado, sem round-trip (mesma lógica pura de
  // resolveSalePlatformFee, só que client-side).
  const preview = useMemo(() => {
    if (previewItems.length === 0) return null
    const platform = (channel === 'SHOPEE' || channel === 'MERCADO_LIVRE') ? platforms.find((p) => p.kind === channel) : undefined
    let saleTotal = 0
    let cost = 0
    let fee = 0
    for (const it of previewItems) {
      saleTotal += it.unitPrice * it.quantity
      cost += (products.find((p) => p.productId === it.productId)?.unitCost ?? 0) * it.quantity
      if (platform) {
        const { feePercent, feeFixed } = resolvePlatformFeeForPrice(platform, it.unitPrice)
        fee += (it.unitPrice * feePercent + feeFixed) * it.quantity
      }
    }
    const profit = saleTotal - cost - fee
    return { saleTotal, cost, fee, profit, margin: saleTotal > 0 ? profit / saleTotal : null }
  }, [previewItems, channel, platforms, products])

  // Legenda "Taxa Shopee: 20% + R$4,00 (≈R$X/un.)" embaixo do campo Valor
  // unitário -- só do item em rascunho (não do agregado acima), mesmo
  // formato de antes desta melhoria.
  const draftFeePreview = useMemo(() => {
    if (channel !== 'SHOPEE' && channel !== 'MERCADO_LIVRE') return null
    const platform = platforms.find((p) => p.kind === channel)
    if (!platform) return null
    const { feePercent, feeFixed } = resolvePlatformFeeForPrice(platform, unitPriceNum)
    return { label: PLATFORM_LABELS[channel], feePercent, feeFixed, feeAmountPerUnit: unitPriceNum * feePercent + feeFixed }
  }, [channel, unitPriceNum, platforms])

  // Convenience only: when the sale is on Shopee/Mercado Livre, suggest that
  // platform's own computed price (cost + markup + THAT platform's specific
  // fee/tax, spec 4.1) as a starting point for unitPrice — still a plain
  // editable field, not a locked value, since the actual sale price can
  // differ.
  async function maybePrefillMarketplacePrice(currentProductId: string, currentChannel: string) {
    if (editingSale) return
    if ((currentChannel !== 'SHOPEE' && currentChannel !== 'MERCADO_LIVRE') || !currentProductId) return
    setPrefilling(true)
    try {
      const result = await getPlatformSalePrice(currentProductId, currentChannel as MarketplacePlatformKind)
      setUnitPrice(result.price.toFixed(2))
    } catch {
      // Product lookup failing here shouldn't block filling the form
      // manually — leave whatever the user already typed in place.
    } finally {
      setPrefilling(false)
    }
  }

  function handleProductChange(newProductId: string) {
    setProductId(newProductId)
    setColorComboKey('')
    void maybePrefillMarketplacePrice(newProductId, channel)
  }

  function handleChannelChange(newChannel: string) {
    setChannel(newChannel)
    void maybePrefillMarketplacePrice(productId, newChannel)
  }

  // Melhoria "Vendas: múltiplos produtos numa venda": confirma o rascunho
  // atual na lista de itens da venda e limpa os campos pro próximo produto
  // -- campos de cabeçalho (Plataforma/Data/Comprador/Observações) não são
  // tocados, continuam valendo pra venda inteira.
  function handleAddItem() {
    if (!productId || !selectedProduct) {
      alert('Selecione um produto')
      return
    }
    if (requiresColorChoice && !colorComboKey) {
      alert('Selecione a cor/variação vendida')
      return
    }
    if (quantityNum <= 0) {
      alert('Informe uma quantidade válida')
      return
    }
    if (unitPriceNum <= 0) {
      alert('Informe um valor unitário válido')
      return
    }
    const variant = selectedProduct.variants.find((v) => v.key === colorComboKey)
    setItems((prev) => [...prev, {
      productId,
      productName: selectedProduct.productName,
      colorComboKey: colorComboKey || null,
      colorLabel: variant?.label ?? null,
      colorHex: variant?.colorHex ?? null,
      quantity: quantityNum,
      unitPrice: unitPriceNum,
    }])
    setProductId('')
    setColorComboKey('')
    setQuantity('1')
    setUnitPrice('')
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function action(formData: FormData) {
    if (editingSale) {
      if (requiresColorChoice && !colorComboKey) {
        alert('Selecione a cor/variação vendida')
        return
      }
      const result = await updateSale(editingSale.id, formData)
      if (!result.success) {
        alert(result.error)
        return
      }
      router.push('/sales')
      return
    }

    // Melhoria "Vendas: múltiplos produtos numa venda": o item em rascunho
    // (se completo) entra automaticamente, então registrar 1 produto só
    // continua sem precisar clicar "+ Adicionar produto" nenhuma vez.
    const finalItems = draftItem ? [...items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, colorComboKey: i.colorComboKey })), draftItem] : items
    if (finalItems.length === 0) {
      if (productId && requiresColorChoice && !colorComboKey) {
        alert('Selecione a cor/variação vendida')
      } else {
        alert('Adicione pelo menos um produto')
      }
      return
    }

    formData.set('itemsJson', JSON.stringify(finalItems))
    const result = await createSaleBatch(formData)
    if (result.success) {
      formRef.current?.reset()
      setUnitPrice('')
      setQuantity('1')
      setColorComboKey('')
      // Bug fix: formRef.reset() only clears uncontrolled fields. productId
      // is controlled by useState (drives the color/variant + marketplace
      // price prefill logic below), so it stayed stuck on the just-sold
      // product for the next entry -- SaleForm keeps the same instance
      // mounted across consecutive "new sale" submits (page.tsx keys it
      // 'new', which never changes between them).
      setProductId('')
      setItems([])
    } else {
      alert(result.error)
    }
  }

  return (
    <div className="tk-panel p-4">
      <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="text-sm">
          Plataforma *
          <select name="channel" value={channel} onChange={(e) => handleChannelChange(e.target.value)} className="tk-input-full" required>
            <option value="" disabled>Selecione</option>
            {editingSale?.channel === 'MARKETPLACE' && (
              <option value="MARKETPLACE">Marketplace (canal antigo)</option>
            )}
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Produto {editingSale && '*'}
          <select name="productId" value={productId} onChange={(e) => handleProductChange(e.target.value)} className="tk-input-full" required={Boolean(editingSale)}>
            <option value="" disabled>Selecione</option>
            {products.map((p) => (
              <option key={p.productId} value={p.productId}>{p.productName}</option>
            ))}
          </select>
        </label>
        {requiresColorChoice && (
          <label className="text-sm">
            Cor/Variação {editingSale && '*'}
            <select name="colorComboKey" value={colorComboKey} onChange={(e) => setColorComboKey(e.target.value)} className="tk-input-full" required={Boolean(editingSale)}>
              <option value="" disabled>Selecione a cor</option>
              {selectedProduct!.variants.map((v) => (
                <option key={v.key} value={v.key} disabled={v.available <= 0}>
                  {v.label} ({v.available} {v.available === 1 ? 'disponível' : 'disponíveis'})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          Quantidade {editingSale && '*'}
          <input name="quantity" type="number" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="tk-input-full" required={Boolean(editingSale)} />
        </label>
        <label className="text-sm">
          Valor unitário {editingSale && '*'} {prefilling && <span className="text-xs font-normal text-slate-400 dark:text-slate-500">(preenchendo…)</span>}
          <input
            name="unitPrice"
            type="number"
            step="0.01"
            min="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            className="tk-input-full"
            required={Boolean(editingSale)}
          />
          {draftFeePreview && !prefilling && (
            <span className="mt-1 block text-xs font-normal text-slate-400 dark:text-slate-500">
              Taxa {draftFeePreview.label}: {(draftFeePreview.feePercent * 100).toFixed(0)}% + {formatCurrency(draftFeePreview.feeFixed)} (≈{formatCurrency(draftFeePreview.feeAmountPerUnit)}/un.)
            </span>
          )}
        </label>

        {!editingSale && (
          <div className="col-span-full">
            <button
              type="button"
              onClick={handleAddItem}
              className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60"
            >
              + Adicionar produto
            </button>
            {items.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                    <span className="flex min-w-0 items-center gap-2">
                      {item.colorHex && <span style={{ background: item.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                      <span className="min-w-0 truncate">
                        {item.productName}{item.colorLabel && <span className="text-slate-500 dark:text-slate-400"> - {item.colorLabel}</span>}{' '}
                        <span className="text-slate-500 dark:text-slate-400">x{item.quantity} · {formatCurrency(item.unitPrice)}</span>
                      </span>
                    </span>
                    <button type="button" onClick={() => removeItem(i)} aria-label="Remover item" className="shrink-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400">🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="text-sm">
          Data da venda *
          <input name="saleDate" type="date" defaultValue={editingSale?.saleDate ?? today()} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Comprador (opcional)
          <input name="buyerOrPlatform" defaultValue={editingSale?.buyerOrPlatform ?? ''} className="tk-input-full" />
        </label>
        <label className="col-span-full text-sm md:col-span-2">
          Observações (opcional)
          <textarea name="notes" defaultValue={editingSale?.notes ?? ''} className="tk-input-full" rows={1} />
        </label>
        <div className="col-span-full mt-2 flex items-center gap-3">
          <SubmitButton pendingLabel="Salvando…">{editingSale ? 'Salvar alterações' : 'Registrar venda'}</SubmitButton>
          {editingSale && (
            <Link href="/sales" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </Link>
          )}
        </div>
      </form>

      {/* Melhoria "Redesign Vendas" §3: prévia ao vivo -- só aparece quando
          há dado suficiente pra calcular algo (senão mostraria R$0 vazio,
          mais confuso que ausente). */}
      {preview && (
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3 dark:border-slate-800">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Custo de produção</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(preview.cost)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Taxa da plataforma</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(preview.fee)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Lucro estimado</p>
            <p className={`mt-1 text-base font-semibold tabular-nums ${preview.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatCurrency(preview.profit)}
            </p>
            {preview.margin !== null && (
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{(preview.margin * 100).toFixed(0)}% de margem</p>
            )}
          </div>
        </div>
      )}

      {/* Melhoria "Redesign Vendas" §4: painel de referência rápida com as
          taxas cadastradas -- mesmo dado (`platforms`) usado na prévia
          acima, só reformatado como lista de leitura. */}
      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Taxas cadastradas</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-500 dark:border-slate-700 dark:text-slate-400">Direta: sem taxa</span>
          {platforms.map((p) => (
            <span key={p.kind} className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-300">
              {PLATFORM_LABELS[p.kind] ?? p.kind}:{' '}
              {p.feeTiers && p.feeTiers.length > 0
                ? p.feeTiers.map((t, i) => (
                    <span key={i}>
                      {i > 0 && ' · '}
                      {t.maxPrice === null ? `acima de R$${p.feeTiers![i - 1].maxPrice?.toFixed(2)}` : `até R$${t.maxPrice.toFixed(2)}`}: {(t.feePercent * 100).toFixed(0)}%+{formatCurrency(t.feeFixed)}
                    </span>
                  ))
                : `${(p.feePercent * 100).toFixed(0)}% + ${formatCurrency(p.feeFixed)}`}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
