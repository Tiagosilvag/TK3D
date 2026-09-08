'use client'
import { useRef } from 'react'
import { createOrder } from '@/actions/orders'
import { ORDER_CHANNEL_LABELS } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

type Option = { id: string; name: string }

const CHANNELS = Object.entries(ORDER_CHANNEL_LABELS) as [keyof typeof ORDER_CHANNEL_LABELS, string][]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function OrderForm({ products }: { products: Option[] }) {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createOrder(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4">
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
        <select name="productId" defaultValue="" className="tk-input-full" required>
          <option value="" disabled>Selecione</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Quantidade *
        <input name="quantity" type="number" step="1" min="1" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Valor unitário *
        <input name="unitPrice" type="number" step="0.01" min="0.01" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Data do pedido *
        <input name="orderDate" type="date" defaultValue={today()} className="tk-input-full" required />
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
  )
}
