'use client'
import { useRef, useState } from 'react'
import { createAccessoryType } from '@/actions/accessoryTypes'
import { SubmitButton } from '@/components/SubmitButton'

export function NewTypeForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function action(formData: FormData) {
    const result = await createAccessoryType(formData)
    if (result.success) {
      formRef.current?.reset()
      setMessage(null)
    } else {
      setMessage(result.error ?? 'Erro ao adicionar.')
    }
  }

  return (
    <form ref={formRef} action={action} className="flex items-end gap-2 tk-panel p-4">
      <label className="text-sm">
        Nome do tipo *
        <input name="name" placeholder="Ex.: Fecho de argola" className="tk-input-full" required />
      </label>
      <SubmitButton pendingLabel="Salvando…">Adicionar tipo</SubmitButton>
      {message && <span className="text-sm text-red-600 dark:text-red-400">{message}</span>}
    </form>
  )
}
