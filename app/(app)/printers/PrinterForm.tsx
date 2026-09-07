'use client'
import { useRef } from 'react'
import { createPrinter } from '@/actions/printers'

export function PrinterForm() {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createPrinter(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-5 gap-2 rounded-lg border border-slate-200 p-4">
      <input name="name" placeholder="Nome" className="rounded border px-2 py-1 text-sm" required />
      <input name="purchasePrice" type="number" step="0.01" placeholder="Preço" className="rounded border px-2 py-1 text-sm" required />
      <input name="depreciationHours" type="number" step="1" placeholder="Horas depreciação" className="rounded border px-2 py-1 text-sm" required />
      <input name="maintenanceCost" type="number" step="0.01" placeholder="Custo manutenção" className="rounded border px-2 py-1 text-sm" required />
      <input name="avgPowerConsumptionKwh" type="number" step="0.001" placeholder="Consumo kWh/h" className="rounded border px-2 py-1 text-sm" required />
      <button className="col-span-5 mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">Adicionar</button>
    </form>
  )
}
