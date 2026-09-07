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
    <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 rounded-lg border border-slate-200 p-4">
      <input name="manufacturer" placeholder="Fabricante" className="rounded border px-2 py-1 text-sm" required />
      <input name="diameterMm" type="number" step="0.01" placeholder="Diâmetro (mm)" className="rounded border px-2 py-1 text-sm" required />
      <input name="spoolPrice" type="number" step="0.01" placeholder="Preço do rolo" className="rounded border px-2 py-1 text-sm" required />
      <input name="spoolWeightKg" type="number" step="0.001" placeholder="Peso do rolo (kg)" className="rounded border px-2 py-1 text-sm" required />
      <input name="densityGCm3" type="number" step="0.001" placeholder="Densidade (g/cm³)" className="rounded border px-2 py-1 text-sm" required />
      <input name="nozzleTempC" type="number" step="1" placeholder="Temp. bico (°C)" className="rounded border px-2 py-1 text-sm" required />
      <input name="bedTempC" type="number" step="1" placeholder="Temp. mesa (°C)" className="rounded border px-2 py-1 text-sm" required />
      <button className="col-span-4 mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">Adicionar</button>
    </form>
  )
}
