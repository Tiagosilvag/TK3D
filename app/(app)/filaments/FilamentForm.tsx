'use client'
import { useRef } from 'react'
import { createFilament } from '@/actions/filaments'

export function FilamentForm() {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createFilament(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
      <input name="manufacturer" placeholder="Fabricante" className="tk-input" required />
      <input name="diameterMm" type="number" step="0.01" placeholder="Diâmetro (mm)" className="tk-input" required />
      <input name="spoolPrice" type="number" step="0.01" placeholder="Preço do rolo" className="tk-input" required />
      <input name="spoolWeightKg" type="number" step="0.001" placeholder="Peso do rolo (kg)" className="tk-input" required />
      <input name="densityGCm3" type="number" step="0.001" placeholder="Densidade (g/cm³)" className="tk-input" required />
      <input name="nozzleTempC" type="number" step="1" placeholder="Temp. bico (°C)" className="tk-input" required />
      <input name="bedTempC" type="number" step="1" placeholder="Temp. mesa (°C)" className="tk-input" required />
      <button className="col-span-4 mt-2 tk-btn-primary">Adicionar</button>
    </form>
  )
}
