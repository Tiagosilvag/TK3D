'use client'
import { useState } from 'react'
import { cancelProductionRun } from '@/actions/productionRuns'

/**
 * Task 8 (spec §5.5): cancel flow for a non-cancelled ProductionRun --
 * confirmation + a mandatory reason. Unlike ConfirmDeleteForm (a single
 * window.confirm), cancelProductionRun requires a free-text reason, so this
 * is a two-step inline form: click "Cancelar" reveals a text input + a
 * window.confirm on submit (same double-check convention as the delete
 * flow) before actually calling the server action.
 */
export function CancelProductionRunForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-red-600 hover:underline dark:text-red-400">
        Cancelar
      </button>
    )
  }

  return (
    <form
      className="flex flex-col items-start gap-1"
      onSubmit={async (e) => {
        e.preventDefault()
        const trimmed = reason.trim()
        if (!trimmed) return
        if (!window.confirm('Confirma o cancelamento desta produção? O estoque consumido será estornado.')) return
        setPending(true)
        const result = await cancelProductionRun(id, trimmed)
        setPending(false)
        if (!result.success) {
          alert(result.error)
          return
        }
        setOpen(false)
        setReason('')
      }}
    >
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo do cancelamento"
        className="tk-input w-40 text-xs"
        required
        autoFocus
      />
      <div className="flex gap-2 text-xs">
        <button type="submit" disabled={pending} className="text-red-600 hover:underline disabled:opacity-50 dark:text-red-400">
          Confirmar
        </button>
        <button type="button" onClick={() => { setOpen(false); setReason('') }} className="text-slate-500 hover:underline dark:text-slate-400">
          Voltar
        </button>
      </div>
    </form>
  )
}
