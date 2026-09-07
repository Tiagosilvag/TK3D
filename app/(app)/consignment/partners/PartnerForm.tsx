'use client'
import { useRef } from 'react'
import { createConsignmentPartner } from '@/actions/consignmentPartners'

export function PartnerForm() {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createConsignmentPartner(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-4">
      <label className="text-sm">
        Nome
        <input name="name" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Comissão padrão (0-1)
        <input name="defaultCommissionPercent" type="number" step="0.01" min="0" max="1" className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="col-span-full text-sm md:col-span-2">
        Observações (opcional)
        <textarea name="notes" className="mt-1 w-full rounded border px-2 py-1 text-sm" rows={1} />
      </label>
      <button className="col-span-full mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">
        Adicionar
      </button>
    </form>
  )
}
