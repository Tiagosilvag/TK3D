'use client'
import { useState } from 'react'

// Melhoria "Meu Estoque" §2: o texto explicativo da fórmula deixa de ocupar
// espaço fixo no topo -- vira um ícone (i) ao lado do título, clique
// abre/fecha.
export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)

  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Como o disponível é calculado"
        className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        i
      </button>
      {open && (
        <span className="absolute left-0 top-7 z-10 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {text}
        </span>
      )}
    </span>
  )
}
