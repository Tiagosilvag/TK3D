'use client'
import { useState } from 'react'
import { renameAccessoryType } from '@/actions/accessoryTypes'
import { SubmitButton } from '@/components/SubmitButton'

export function RenameTypeForm({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function action(formData: FormData) {
    const result = await renameAccessoryType(id, formData)
    if (result.success) {
      setEditing(false)
      setMessage(null)
    } else {
      setMessage(result.error ?? 'Erro ao renomear.')
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-slate-800 dark:text-slate-200">{name}</span>
        <button type="button" onClick={() => setEditing(true)} className="text-amber-600 hover:underline dark:text-amber-400">
          Renomear
        </button>
      </div>
    )
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`type-name-${id}`}>Nome do tipo *</label>
      <input id={`type-name-${id}`} name="name" defaultValue={name} required className="tk-input" />
      <SubmitButton pendingLabel="Salvando…" className="tk-btn-primary px-2 py-1 text-xs">Salvar</SubmitButton>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500 hover:underline dark:text-slate-400">
        Cancelar
      </button>
      {message && <span className="text-xs text-red-600 dark:text-red-400">{message}</span>}
    </form>
  )
}
