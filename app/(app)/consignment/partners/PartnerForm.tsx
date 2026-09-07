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
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4">
      <label className="text-sm">
        Nome
        <input name="name" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Comissão padrão (0-1)
        <input name="defaultCommissionPercent" type="number" step="0.01" min="0" max="1" className="tk-input-full" required />
      </label>
      <label className="col-span-full text-sm md:col-span-2">
        Observações (opcional)
        <textarea name="notes" className="tk-input-full" rows={1} />
      </label>
      <button className="col-span-full mt-2 tk-btn-primary">
        Adicionar
      </button>
    </form>
  )
}
