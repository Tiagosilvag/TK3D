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
    <form ref={formRef} action={action} className="grid grid-cols-3 gap-2 tk-panel p-4">
      <input name="name" placeholder="Nome" className="tk-input" required />
      <input name="unitCost" type="number" step="0.0001" placeholder="Custo unitário" className="tk-input" required />
      <button className="col-span-3 mt-2 tk-btn-primary">Adicionar</button>
    </form>
  )
}
