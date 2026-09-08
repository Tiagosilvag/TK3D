'use client'
import { useFormStatus } from 'react-dom'

// Prevents duplicate submissions from a double-click: disabled and showing a
// loading label the instant the form's action starts, re-enabled only after
// the server responds. Must be rendered INSIDE the <form> it belongs to —
// useFormStatus reads the nearest parent form's pending state.
export function SubmitButton({
  children,
  pendingLabel = 'Salvando…',
  className = 'tk-btn-primary',
  disabled = false,
}: {
  children: React.ReactNode
  pendingLabel?: string
  className?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending || disabled} className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}>
      {pending ? pendingLabel : children}
    </button>
  )
}
