'use client'
import { useRef } from 'react'
import { createPackagingItem } from '@/actions/packaging'

export function PackagingForm() {
  const formRef = useRef<HTMLFormElement>(null)

  async function action(formData: FormData) {
    const result = await createPackagingItem(formData)
    if (result.success) formRef.current?.reset()
    else alert(result.error)
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 p-4">
      <input name="name" placeholder="Nome" className="rounded border px-2 py-1 text-sm" required />
      <input name="unitCost" type="number" step="0.0001" placeholder="Custo unitário" className="rounded border px-2 py-1 text-sm" required />
      <button className="col-span-3 mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">Adicionar</button>
    </form>
  )
}
