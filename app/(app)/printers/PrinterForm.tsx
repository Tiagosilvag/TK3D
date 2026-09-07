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
    <form ref={formRef} action={action} className="grid grid-cols-5 gap-2 tk-panel p-4">
      <input name="name" placeholder="Nome" className="tk-input" required />
      <input name="purchasePrice" type="number" step="0.01" placeholder="Preço" className="tk-input" required />
      <input name="depreciationHours" type="number" step="1" placeholder="Horas depreciação" className="tk-input" required />
      <input name="maintenanceCost" type="number" step="0.01" placeholder="Custo manutenção" className="tk-input" required />
      <input name="avgPowerConsumptionKwh" type="number" step="0.001" placeholder="Consumo kWh/h" className="tk-input" required />
      <button className="col-span-5 mt-2 tk-btn-primary">Adicionar</button>
    </form>
  )
}
