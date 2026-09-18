'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSale, updateSale } from '@/actions/sales'
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

  const selectedProduct = useMemo(() => products.find((p) => p.productId === productId), [products, productId])

  // Melhoria "Vendas por variante": mesma UX de DeliveryBatchForm -- venda
  // de um produto com mais de uma cor em estoque exige escolher qual foi
  // vendida (sem isso, "Meu Estoque" não consegue descontar a cor certa).
  // Produto sem variante conhecida (getProductVariantBreakdown não achou
  // nenhuma) não pede cor -- mesma convenção de Entregas.
  const requiresColorChoice = Boolean(selectedProduct && selectedProduct.variants.length > 0)

  // Melhoria "Redesign Vendas" §3: prévia ao vivo -- 3 blocos que
  // recalculam a cada mudança de Plataforma/Produto/Variação/Quantidade/
  // Valor unitário, sem precisar salvar a venda. Cor/variação não entra na
  // conta (o custeio não diferencia por cor), só nas outras 4.
  const quantityNum = Number(quantity) || 0
  const unitPriceNum = Number(unitPrice) || 0
  const saleTotalPreview = unitPriceNum * quantityNum
  const costPreview = selectedProduct ? selectedProduct.unitCost * quantityNum : null
  const platformFeePreview = useMemo(() => {
    if (channel !== 'SHOPEE' && channel !== 'MERCADO_LIVRE') return null
    const platform = platforms.find((p) => p.kind === channel)
    if (!platform) return null
    const { feePercent, feeFixed } = resolvePlatformFeeForPrice(platform, unitPriceNum)
    return { label: PLATFORM_LABELS[channel], feePercent, feeFixed, feeAmountPerUnit: unitPriceNum * feePercent + feeFixed, feeAmountTotal: (unitPriceNum * feePercent + feeFixed) * quantityNum }
  }, [channel, unitPriceNum, quantityNum, platforms])
  const profitPreview = costPreview !== null ? saleTotalPreview - costPreview - (platformFeePreview?.feeAmountTotal ?? 0) : null
  const marginPreview = profitPreview !== null && saleTotalPreview > 0 ? profitPreview / saleTotalPreview : null
  const showPreview = Boolean(channel && productId && quantityNum > 0 && unitPriceNum > 0)

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

  async function action(formData: FormData) {
    if (requiresColorChoice && !colorComboKey) {
      alert('Selecione a cor/variação vendida')
      return
    }
    if (editingSale) {
      const result = await updateSale(editingSale.id, formData)
      if (!result.success) {
        alert(result.error)
        return
      }
      router.push('/sales')
      return
    }
    const result = await createSale(formData)
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
          Produto *
          <select name="productId" value={productId} onChange={(e) => handleProductChange(e.target.value)} className="tk-input-full" required>
            <option value="" disabled>Selecione</option>
            {products.map((p) => (
              <option key={p.productId} value={p.productId}>{p.productName}</option>
            ))}
          </select>
        </label>
        {requiresColorChoice && (
          <label className="text-sm">
            Cor/Variação *
            <select name="colorComboKey" value={colorComboKey} onChange={(e) => setColorComboKey(e.target.value)} className="tk-input-full" required>
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
          Quantidade *
          <input name="quantity" type="number" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Valor unitário * {prefilling && <span className="text-xs font-normal text-slate-400 dark:text-slate-500">(preenchendo…)</span>}
          <input
            name="unitPrice"
            type="number"
            step="0.01"
            min="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            className="tk-input-full"
            required
          />
          {platformFeePreview && !prefilling && (
            <span className="mt-1 block text-xs font-normal text-slate-400 dark:text-slate-500">
              Taxa {platformFeePreview.label}: {(platformFeePreview.feePercent * 100).toFixed(0)}% + {formatCurrency(platformFeePreview.feeFixed)} (≈{formatCurrency(platformFeePreview.feeAmountPerUnit)}/un.)
            </span>
          )}
        </label>
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
      {showPreview && (
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3 dark:border-slate-800">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Custo de produção</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{costPreview !== null ? formatCurrency(costPreview) : '—'}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Taxa da plataforma</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(platformFeePreview?.feeAmountTotal ?? 0)}</p>
            {platformFeePreview && (
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{(platformFeePreview.feePercent * 100).toFixed(0)}% + {formatCurrency(platformFeePreview.feeFixed)}</p>
            )}
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Lucro estimado</p>
            <p className={`mt-1 text-base font-semibold tabular-nums ${(profitPreview ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {profitPreview !== null ? formatCurrency(profitPreview) : '—'}
            </p>
            {marginPreview !== null && (
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{(marginPreview * 100).toFixed(0)}% de margem</p>
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
