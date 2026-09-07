'use client'
import { useRef } from 'react'
import { createProductionRun } from '@/actions/productionRuns'

type Option = { id: string; name: string }

export function ProductionRunForm({
  products,
  printers,
  filaments,
}: {
  products: Option[]
  printers: Option[]
  filaments: Option[]
}) {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createProductionRun(formData)
    if (result.success) {
      formRef.current?.reset()
    } else {
      alert(result.error)
    }
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-4">
      <label className="text-sm">
        Produto
        <select name="productId" defaultValue="" className="mt-1 w-full rounded border px-2 py-1 text-sm" required>
          <option value="" disabled>Selecione</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Impressora
        <select name="printerId" defaultValue="" className="mt-1 w-full rounded border px-2 py-1 text-sm" required>
          <option value="" disabled>Selecione</option>
          {printers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Filamento
        <select name="filamentId" defaultValue="" className="mt-1 w-full rounded border px-2 py-1 text-sm" required>
          <option value="" disabled>Selecione</option>
          {filaments.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Data
        <input name="date" type="date" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Qtd. planejada
        <input name="quantityPlanned" type="number" step="1" min="1" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Qtd. sucesso
        <input name="quantitySuccess" type="number" step="1" min="0" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Qtd. falhas
        <input name="quantityFailed" type="number" step="1" min="0" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Filamento desperdiçado (g)
        <input name="gramsWasted" type="number" step="0.01" min="0" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Tempo desperdiçado (h)
        <input name="timeWastedHours" type="number" step="0.001" min="0" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="col-span-full text-sm md:col-span-3">
        Observações (opcional)
        <textarea name="notes" className="mt-1 w-full rounded border px-2 py-1 text-sm" rows={2} />
      </label>
      <button className="col-span-full mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">
        Registrar
      </button>
    </form>
  )
}
