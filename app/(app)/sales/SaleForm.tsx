'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSale, updateSale } from '@/actions/sales'
import { getPlatformSalePrice } from '@/actions/marketplacePlatforms'
import { SubmitButton } from '@/components/SubmitButton'
import type { MarketplacePlatformKind } from '@prisma/client'

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

export function SaleForm({
  products,
  editingSale,
  defaultProductId,
}: {
  products: ProductOption[]
  editingSale?: EditingSale
  // 2.2: link de ação rápida "Registrar venda direta" em /stock chega aqui
  // com ?productId=... pra pré-selecionar o produto.
  defaultProductId?: string
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [unitPrice, setUnitPrice] = useState(editingSale ? String(editingSale.unitPrice) : '')
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

  // Convenience only: when the sale is on Shopee/Mercado Livre, suggest that
  // platform's own computed price (cost + markup + THAT platform's specific
  // fee/tax, spec 4.1) as a starting point for unitPrice — still a plain
  // editable field, not a locked value, since the actual sale price can
  // differ.
  async function maybePrefillMarketplacePrice(currentProductId: string, channel: string) {
    if (editingSale) return
    if ((channel !== 'SHOPEE' && channel !== 'MERCADO_LIVRE') || !currentProductId) return
    setPrefilling(true)
    try {
      const price = await getPlatformSalePrice(currentProductId, channel as MarketplacePlatformKind)
      setUnitPrice(price.toFixed(2))
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
    const form = formRef.current
    if (form) {
      const channel = String(new FormData(form).get('channel') ?? '')
      void maybePrefillMarketplacePrice(newProductId, channel)
    }
  }

  function handleChannelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    void maybePrefillMarketplacePrice(productId, e.target.value)
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
      setColorComboKey('')
    } else {
      alert(result.error)
    }
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4"
    >
      <label className="text-sm">
        Plataforma *
        <select name="channel" defaultValue={editingSale?.channel ?? ''} onChange={handleChannelChange} className="tk-input-full" required>
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
                {v.label} ({v.available} disponível{v.available === 1 ? '' : 'is'})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm">
        Quantidade *
        <input name="quantity" type="number" step="1" min="1" defaultValue={editingSale?.quantity} className="tk-input-full" required />
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
  )
}
