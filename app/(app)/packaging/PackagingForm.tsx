'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createPackagingItem, updatePackagingItem } from '@/actions/packaging'
import { SubmitButton } from '@/components/SubmitButton'

type EditingItem = { id: string; name: string; unitCost: number }

export function PackagingForm({ editingItem }: { editingItem?: EditingItem }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState(editingItem?.name ?? '')
  const [unitCost, setUnitCost] = useState(editingItem ? String(editingItem.unitCost) : '')

  async function action(formData: FormData) {
    const result = editingItem
      ? await updatePackagingItem(editingItem.id, formData)
      : await createPackagingItem(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    if (editingItem) {
      router.push('/packaging')
      return
    }
    formRef.current?.reset()
    setName('')
    setUnitCost('')
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-3 gap-2 tk-panel p-4">
      <label className="text-sm">
        Nome *
        <input name="name" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Custo unitário *
        <input name="unitCost" type="number" step="0.0001" placeholder="Custo unitário" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="tk-input-full" required />
      </label>
      <div className="col-span-3 mt-2 flex items-center gap-3">
        <SubmitButton pendingLabel="Salvando…">{editingItem ? 'Salvar alterações' : 'Adicionar'}</SubmitButton>
        {editingItem && (
          <Link href="/packaging" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </Link>
        )}
      </div>
    </form>
  )
}
