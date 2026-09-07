'use client'
import { useRef } from 'react'
import { createAccessory } from '@/actions/accessories'

const ACCESSORY_TYPES = [
  { value: 'CORRENTE_BOLINHA', label: 'Corrente bolinha' },
  { value: 'CORRENTE_ELO', label: 'Corrente elo' },
  { value: 'MOSQUETAO', label: 'Mosquetão' },
  { value: 'CLICKER', label: 'Clicker' },
  { value: 'OUTRO', label: 'Outro' },
]

export function AccessoryForm() {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createAccessory(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-3 gap-2 tk-panel p-4">
      <input name="name" placeholder="Nome" className="tk-input" required />
      <select name="type" className="tk-input" required defaultValue="">
        <option value="" disabled>Tipo</option>
        {ACCESSORY_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      <input name="unitCost" type="number" step="0.0001" placeholder="Custo unitário" className="tk-input" required />
      <button className="col-span-3 mt-2 tk-btn-primary">Adicionar</button>
    </form>
  )
}
