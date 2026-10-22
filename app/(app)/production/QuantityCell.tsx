'use client'
import { useEffect, useRef, useState } from 'react'
import { updateProductionRunQuantities, type ProductionRunEditInput } from '@/actions/productionRuns'

// Sucesso / Falhas editáveis direto na célula: clicar abre dois campos,
// Enter salva, Esc ou clicar fora cancela. Não deixa zerar tudo (pra isso,
// Excluir). O servidor recalcula estoque, custo, status e pendências.
export function QuantityCell({
  runId,
  success,
  failed,
  disabled,
  onSaved,
}: {
  runId: string
  success: number
  failed: number
  disabled?: boolean
  onSaved: (previous: ProductionRunEditInput) => void
}) {
  const [editing, setEditing] = useState(false)
  const [s, setS] = useState(String(success))
  const [f, setF] = useState(String(failed))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!editing) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) cancel()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  })

  function open() {
    setS(String(success))
    setF(String(failed))
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    const result = await updateProductionRunQuantities(runId, parseInt(s, 10), parseInt(f, 10))
    setSaving(false)
    if (!result.success) {
      setError(result.error ?? 'Erro ao salvar.')
      return
    }
    setEditing(false)
    if (result.previous) onSaved(result.previous)
  }

  const display = (
    <>
      <span className="text-emerald-600 dark:text-emerald-400">{success}</span> / <span className={failed > 0 ? 'text-red-600 dark:text-red-400' : ''}>{failed}</span>
    </>
  )

  if (disabled) return <span>{display}</span>
  if (!editing) {
    return (
      <button type="button" onClick={open} title="Clique para corrigir sucesso/falhas" className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800">
        {display}
      </button>
    )
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  return (
    <span ref={ref} className="inline-flex flex-col items-center gap-1">
      <span className="inline-flex items-center gap-1">
        <input
          type="number" min={0} value={s} autoFocus onFocus={(e) => e.target.select()}
          onChange={(e) => setS(e.target.value)} onKeyDown={onKeyDown} aria-label="Sucesso"
          className="tk-input-full w-14 px-1 text-center"
        />
        <span>/</span>
        <input
          type="number" min={0} value={f} onFocus={(e) => e.target.select()}
          onChange={(e) => setF(e.target.value)} onKeyDown={onKeyDown} aria-label="Falhas"
          className="tk-input-full w-14 px-1 text-center"
        />
      </span>
      {error && <span className="max-w-[16rem] text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  )
}
