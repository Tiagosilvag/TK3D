'use client'
import { useRef, useState } from 'react'
import { createSale } from '@/actions/sales'
import { getProductCostBreakdown } from '@/actions/products'

type Option = { id: string; name: string }

const CHANNELS = [
  { value: 'DIRETA', label: 'Direta' },
  { value: 'MARKETPLACE', label: 'Marketplace' },
]

export function SaleForm({ products }: { products: Option[] }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [unitPrice, setUnitPrice] = useState('')
  const [prefilling, setPrefilling] = useState(false)

  // Convenience only: when the sale is on the marketplace, suggest the
  // product's computed marketplace price (cost + markup + marketplace fees)
  // as a starting point for unitPrice — still a plain editable field, not a
  // locked value, since the actual sale price can differ.
  async function maybePrefillMarketplacePrice(productId: string, channel: string) {
    if (channel !== 'MARKETPLACE' || !productId) return
    setPrefilling(true)
    try {
      const breakdown = await getProductCostBreakdown(productId)
      setUnitPrice(breakdown.marketplacePrice.toFixed(2))
    } catch {
      // Product lookup failing here shouldn't block filling the form
      // manually — leave whatever the user already typed in place.
    } finally {
      setPrefilling(false)
    }
  }

  function handleChannelOrProductChange(form: HTMLFormElement) {
    const data = new FormData(form)
    const productId = String(data.get('productId') ?? '')
    const channel = String(data.get('channel') ?? '')
    void maybePrefillMarketplacePrice(productId, channel)
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    handleChannelOrProductChange(e.currentTarget.form!)
  }

  async function action(formData: FormData) {
    const result = await createSale(formData)
    if (result.success) {
      formRef.current?.reset()
      setUnitPrice('')
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
        Canal
        <select name="channel" defaultValue="" onChange={handleSelectChange} className="tk-input-full" required>
          <option value="" disabled>Selecione</option>
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Produto
        <select name="productId" defaultValue="" onChange={handleSelectChange} className="tk-input-full" required>
          <option value="" disabled>Selecione</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Quantidade
        <input name="quantity" type="number" step="1" min="1" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Valor unitário {prefilling && <span className="text-xs font-normal text-slate-400 dark:text-slate-500">(preenchendo…)</span>}
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
        Data da venda
        <input name="saleDate" type="date" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Comprador/Plataforma (opcional)
        <input name="buyerOrPlatform" className="tk-input-full" />
      </label>
      <label className="col-span-full text-sm md:col-span-2">
        Observações (opcional)
        <textarea name="notes" className="tk-input-full" rows={1} />
      </label>
      <button className="col-span-full mt-2 tk-btn-primary">
        Registrar venda
      </button>
    </form>
  )
}
