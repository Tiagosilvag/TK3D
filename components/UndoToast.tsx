'use client'
import { useEffect } from 'react'

// Redesign "Pedidos" -- "✓ Entregar tudo" mostra isto depois de marcar
// entregue: nada igual existe no app (confirmado na pesquisa -- banner
// dispensável mais próximo é o de realocação em OrderForm.tsx, mas sem
// auto-expirar nem "Desfazer"). Combina esse mesmo visual de banner
// dispensável com o padrão setTimeout de auto-expirar já usado em
// AnycubicConnectionForm.tsx ("copiado!" por alguns segundos).
export function UndoToast({
  message,
  onUndo,
  onDismiss,
  durationMs = 6000,
}: {
  message: string
  onUndo?: () => void
  onDismiss: () => void
  durationMs?: number
}) {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timeout)
  }, [onDismiss, durationMs])

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg dark:border-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-300">
      <span>{message}</span>
      {onUndo && (
        <button type="button" onClick={onUndo} className="font-medium underline hover:no-underline">Desfazer</button>
      )}
      <button type="button" onClick={onDismiss} aria-label="Fechar" className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400">✕</button>
    </div>
  )
}
