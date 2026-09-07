'use client'
import { useRef } from 'react'
import { createSupply } from '@/actions/supplies'

const SUPPLY_UNITS = [
  { value: 'UN', label: 'Unidade' },
  { value: 'ML', label: 'Mililitro' },
  { value: 'G', label: 'Grama' },
]

export function SupplyForm() {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createSupply(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 p-4">
      <input name="name" placeholder="Nome" className="rounded border px-2 py-1 text-sm" required />
      <select name="unit" className="rounded border px-2 py-1 text-sm" required defaultValue="">
        <option value="" disabled>Unidade</option>
        {SUPPLY_UNITS.map((u) => (
          <option key={u.value} value={u.value}>{u.label}</option>
        ))}
      </select>
      <input name="unitCost" type="number" step="0.0001" placeholder="Custo unitário" className="rounded border px-2 py-1 text-sm" required />
      <button className="col-span-3 mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">Adicionar</button>
    </form>
  )
}
