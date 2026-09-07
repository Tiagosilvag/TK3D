'use client'
import { useRef } from 'react'
import { createConsignmentDelivery } from '@/actions/consignmentDeliveries'

type Option = { id: string; name: string }

export function DeliveryForm({ partners, products }: { partners: Option[]; products: Option[] }) {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createConsignmentDelivery(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4">
      <label className="text-sm">
        Parceiro
        <select name="partnerId" defaultValue="" className="tk-input-full" required>
          <option value="" disabled>Selecione</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Produto
        <select name="productId" defaultValue="" className="tk-input-full" required>
          <option value="" disabled>Selecione</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Quantidade entregue
        <input name="quantityDelivered" type="number" step="1" min="1" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Preço unitário
        <input name="unitPrice" type="number" step="0.01" min="0.01" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Data da entrega
        <input name="deliveryDate" type="date" className="tk-input-full" required />
      </label>
      <label className="col-span-full text-sm md:col-span-3">
        Observações (opcional)
        <textarea name="notes" className="tk-input-full" rows={1} />
      </label>
      <button className="col-span-full mt-2 tk-btn-primary">
        Registrar entrega
      </button>
    </form>
  )
}
