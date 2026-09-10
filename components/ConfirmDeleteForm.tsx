'use client'
import { useActionState } from 'react'

type ActionResult = { success: boolean; error?: string }

/**
 * Wraps a destructive server-action form with a client-side confirmation
 * dialog. Kept intentionally minimal (no new dependencies): a plain
 * window.confirm() on submit, cancelled via preventDefault() when the user
 * backs out. Bug fix: a delete blocked server-side (ex.: FK constraint --
 * item ainda referenciado por um produto) returns { success: false, error }
 * instead of throwing, but this form used to just discard whatever the
 * action returned -- nothing told the user why the item was still there.
 * useActionState captures that return value and shows it below the button.
 */
export function ConfirmDeleteForm({
  action,
  label = 'Remover',
  confirmMessage = 'Tem certeza?',
  className = 'text-red-600 hover:underline dark:text-red-400',
}: {
  action: () => Promise<ActionResult | void>
  label?: string
  confirmMessage?: string
  className?: string
}) {
  const [result, formAction] = useActionState<ActionResult | null>(async () => {
    const res = await action()
    return res && !res.success ? res : null
  }, null)

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault()
      }}
    >
      <button className={className}>{label}</button>
      {result?.error && <p className="mt-1 max-w-[220px] text-xs text-red-600 dark:text-red-400">{result.error}</p>}
    </form>
  )
}
