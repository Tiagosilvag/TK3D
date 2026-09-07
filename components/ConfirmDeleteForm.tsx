'use client'

/**
 * Wraps a destructive server-action form with a client-side confirmation
 * dialog. Kept intentionally minimal (no new dependencies): a plain
 * window.confirm() on submit, cancelled via preventDefault() when the user
 * backs out.
 */
export function ConfirmDeleteForm({
  action,
  label = 'Remover',
  confirmMessage = 'Tem certeza?',
  className = 'text-red-600 hover:underline',
}: {
  action: () => Promise<void>
  label?: string
  confirmMessage?: string
  className?: string
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault()
      }}
    >
      <button className={className}>{label}</button>
    </form>
  )
}
