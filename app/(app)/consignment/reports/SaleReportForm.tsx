'use client'
import { useMemo, useRef, useState } from 'react'
import { createConsignmentSaleReport } from '@/actions/consignmentSaleReports'

type DeliveryOption = {
  id: string
  partnerName: string
  productName: string
  remaining: number
  defaultCommissionPercent: number
}

export function SaleReportForm({ deliveries }: { deliveries: DeliveryOption[] }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [deliveryId, setDeliveryId] = useState('')
  const [commissionPercent, setCommissionPercent] = useState('')

  const selected = useMemo(() => deliveries.find((d) => d.id === deliveryId), [deliveries, deliveryId])

  function handleDeliveryChange(id: string) {
    setDeliveryId(id)
    const delivery = deliveries.find((d) => d.id === id)
    if (delivery) setCommissionPercent(String(delivery.defaultCommissionPercent))
  }

  async function action(formData: FormData) {
    const result = await createConsignmentSaleReport(formData)
    if (result.success) {
      formRef.current?.reset()
      setDeliveryId('')
      setCommissionPercent('')
    } else {
      alert(result.error)
    }
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-4">
      <label className="text-sm">
        Entrega
        <select
          name="deliveryId"
          value={deliveryId}
          onChange={(e) => handleDeliveryChange(e.target.value)}
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          required
        >
          <option value="" disabled>Selecione</option>
          {deliveries.map((d) => (
            <option key={d.id} value={d.id}>
              {d.partnerName} — {d.productName} (saldo: {d.remaining})
            </option>
          ))}
        </select>
        {selected && (
          <span className="mt-1 block text-xs text-slate-500">Saldo restante: {selected.remaining}</span>
        )}
      </label>
      <label className="text-sm">
        Quantidade vendida
        <input
          name="quantitySold"
          type="number"
          step="1"
          min="1"
          max={selected?.remaining}
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          required
        />
      </label>
      <label className="text-sm">
        Data do relatório
        <input name="reportDate" type="date" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Comissão (0-1)
        <input
          name="commissionPercent"
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={commissionPercent}
          onChange={(e) => setCommissionPercent(e.target.value)}
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          required
        />
      </label>
      <label className="col-span-full text-sm md:col-span-3">
        Observações (opcional)
        <textarea name="notes" className="mt-1 w-full rounded border px-2 py-1 text-sm" rows={1} />
      </label>
      <button className="col-span-full mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">
        Registrar venda
      </button>
    </form>
  )
}
