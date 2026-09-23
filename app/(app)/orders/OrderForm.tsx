'use client'
import { useMemo, useRef, useState } from 'react'
import { createOrder } from '@/actions/orders'
import { ORDER_CHANNEL_LABELS } from '@/lib/format'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { SubmitButton } from '@/components/SubmitButton'
import { CustomVariantPicker, type CustomVariantChoice } from './CustomVariantPicker'
import type { OrderReallocationEvent } from '@/lib/orderReservations'

const CHANNELS = Object.entries(ORDER_CHANNEL_LABELS) as [keyof typeof ORDER_CHANNEL_LABELS, string][]

// Melhoria "Pedidos com reserva de estoque": mesmo shape de
// SaleForm.tsx#ProductVariantOption/ProductOption -- Pedidos passa a
// escolher cor/variação igual Vendas já fazia, pra poder reservar a
// variação certa (Order.colorComboKey).
export interface OrderProductVariantOption {
  key: string
  label: string
  colorHex: string | null
  available: number
}

export interface OrderProductOption {
  productId: string
  productName: string
  needsAssembly: boolean
  variants: OrderProductVariantOption[]
}

export function OrderForm({ products }: { products: OrderProductOption[] }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [productId, setProductId] = useState('')
  const [colorComboKey, setColorComboKey] = useState('')
  const [customChoice, setCustomChoice] = useState<CustomVariantChoice | null>(null)
  const [reallocations, setReallocations] = useState<OrderReallocationEvent[] | null>(null)

  const selectedProduct = useMemo(() => products.find((p) => p.productId === productId), [products, productId])
  // Encomenda com variação personalizada: produto que precisa de
  // montagem sempre pede uma variação (mesmo sem NENHUMA já pronta --
  // "+ Montar variação personalizada" cobre esse caso); produto sem
  // montagem só pede quando já existe variante rastreada (comportamento
  // de sempre).
  const requiresColorChoice = Boolean(selectedProduct && (selectedProduct.variants.length > 0 || selectedProduct.needsAssembly))

  function handleProductChange(newProductId: string) {
    setProductId(newProductId)
    setColorComboKey('')
    setCustomChoice(null)
  }

  async function action(formData: FormData) {
    if (requiresColorChoice && !colorComboKey && !customChoice) {
      alert('Selecione a cor/variação pedida')
      return
    }
    if (customChoice) formData.set('colorChoicesJson', JSON.stringify(customChoice.choices))
    const result = await createOrder(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    setReallocations(result.reallocations && result.reallocations.length > 0 ? result.reallocations : null)
    formRef.current?.reset()
    setProductId('')
    setColorComboKey('')
    setCustomChoice(null)
  }

  return (
    <div className="tk-panel p-4">
      {/* Melhoria "Pedidos com reserva de estoque" §4: aviso passageiro --
          só existe aqui (criar/editar pedido é a ÚNICA ação que pode tomar
          peça reservada de outro pedido; produção/montagem só adicionam
          estoque, nunca tiram de ninguém). Some ao fechar ou ao
          registrar o próximo pedido. */}
      {reallocations && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">⚠ Peça realocada</p>
              <ul className="mt-1 list-disc pl-4">
                {reallocations.map((r, i) => (
                  <li key={i}>
                    {r.quantity} unidade{r.quantity === 1 ? '' : 's'} que estava{r.quantity === 1 ? '' : 'm'} reservada{r.quantity === 1 ? '' : 's'} pro pedido {r.fromOrderNumber ? `#${r.fromOrderNumber}` : '(sem número)'} (prazo mais longe) {r.quantity === 1 ? 'passou' : 'passaram'} pra este pedido, mais urgente.
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" onClick={() => setReallocations(null)} aria-label="Fechar" className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400">✕</button>
          </div>
        </div>
      )}

      <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="text-sm">
          Canal *
          <select name="channel" defaultValue="" className="tk-input-full" required>
            <option value="" disabled>Selecione</option>
            {CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
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
          <div className="text-sm">
            <span className="mb-1 block">Cor/Variação *</span>
            {customChoice ? (
              <div className="flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-sm dark:border-violet-700 dark:bg-violet-500/10">
                <span className="min-w-0 flex-1 truncate text-violet-800 dark:text-violet-300">{customChoice.label || 'Personalizado'}</span>
                <button type="button" onClick={() => setCustomChoice(null)} className="shrink-0 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300">
                  Trocar
                </button>
              </div>
            ) : (
              <>
                {selectedProduct!.variants.length > 0 && (
                  <select name="colorComboKey" value={colorComboKey} onChange={(e) => setColorComboKey(e.target.value)} className="tk-input-full">
                    <option value="" disabled>Selecione a cor</option>
                    {selectedProduct!.variants.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.label} ({v.available} {v.available === 1 ? 'disponível' : 'disponíveis'})
                      </option>
                    ))}
                  </select>
                )}
                {selectedProduct!.needsAssembly && (
                  <CustomVariantPicker
                    key={productId}
                    productId={productId}
                    onConfirm={(choice) => { setCustomChoice(choice); setColorComboKey('') }}
                    trigger={
                      <button type="button" className="mt-1 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                        + Montar variação personalizada
                      </button>
                    }
                  />
                )}
              </>
            )}
          </div>
        )}
        <label className="text-sm">
          Quantidade *
          <input name="quantity" type="number" step="1" min="1" className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Valor unitário *
          <input name="unitPrice" type="number" step="0.01" min="0.01" className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Comprador (opcional)
          <input name="buyerOrPlatform" className="tk-input-full" />
        </label>
        <label className="text-sm">
          Data do pedido *
          <input name="orderDate" type="date" defaultValue={today()} className="tk-input-full" required />
          <span className="mt-1 block text-xs font-normal text-slate-400 dark:text-slate-500">Quando o pedido foi feito.</span>
        </label>
        <label className="text-sm">
          Data de entrega *
          <input name="deliveryDate" type="date" defaultValue={today()} className="tk-input-full" required />
          <span className="mt-1 block text-xs font-normal text-slate-400 dark:text-slate-500">Quando precisa estar pronto/entregue.</span>
        </label>
        <label className="text-sm">
          Número do pedido (opcional)
          <input name="orderNumber" className="tk-input-full" />
        </label>
        <label className="col-span-full text-sm md:col-span-2">
          Observações (opcional)
          <textarea name="notes" className="tk-input-full" rows={1} />
        </label>
        <div className="col-span-full mt-2">
          <SubmitButton pendingLabel="Salvando…">Registrar pedido</SubmitButton>
        </div>
      </form>
    </div>
  )
}
