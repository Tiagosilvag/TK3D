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
    <form ref={formRef} action={action} className="grid grid-cols-3 gap-2 tk-panel p-4">
      <input name="name" placeholder="Nome" className="tk-input" required />
      <select name="unit" className="tk-input" required defaultValue="">
        <option value="" disabled>Unidade</option>
        {SUPPLY_UNITS.map((u) => (
          <option key={u.value} value={u.value}>{u.label}</option>
        ))}
      </select>
      <input name="unitCost" type="number" step="0.0001" placeholder="Custo unitário" className="tk-input" required />
      <button className="col-span-3 mt-2 tk-btn-primary">Adicionar</button>
    </form>
  )
}
