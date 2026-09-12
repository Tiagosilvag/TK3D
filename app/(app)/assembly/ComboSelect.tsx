'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ComboOption {
  key: string
  label: string
  colorHex: string | null
  available: number
}

function Swatch({ colorHex, className = 'h-5 w-5' }: { colorHex: string | null; className?: string }) {
  return colorHex ? (
    <span style={{ background: colorHex }} className={`inline-block shrink-0 rounded-md border border-slate-300/50 dark:border-slate-600/50 ${className}`} />
  ) : (
    <span className={`inline-block shrink-0 rounded-md border border-dashed border-slate-300 dark:border-slate-600 ${className}`} />
  )
}

// Melhoria "Montagem" (redesign): peça/componente/acessório com cor
// variável precisa mostrar cor + rótulo + disponível TUDO junto, com
// opções zeradas bloqueadas em vez de só um <option disabled> nativo
// (que não permite bolinha de cor nem destaque visual) -- mesma
// necessidade que FilamentSelect.tsx já resolveu, adaptado aqui pro
// shape AssemblyPartColorOption (key/label/colorHex/available) e sem
// busca (poucas opções, tipicamente 1-5). Painel em backdrop+portal
// pro <body>, nunca <dialog> -- este seletor vive dentro do modal de
// Montagem, que já é um <dialog> nativo; dois <dialog> empilhados têm
// um bug de stacking real em Chrome (ver comentário em
// ComponentCategoryCard.tsx), então segue o mesmo padrão já corrigido
// lá (painel comum controlado por estado, não showModal()).
export function ComboSelect({
  options,
  value,
  onChange,
}: {
  options: ComboOption[]
  value: string
  onChange: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const selected = options.find((o) => o.key === value) ?? null

  // Uma única opção = nada pra escolher de verdade -- mostra a info
  // (cor/rótulo/disponível) como uma linha estática, sem abrir um
  // seletor que não teria nada além da própria opção já exibida.
  if (options.length <= 1) {
    const only = options[0] ?? null
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800/60">
        <Swatch colorHex={only?.colorHex ?? null} />
        <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-300">{only?.label ?? 'Sem produção registrada'}</span>
        {only && (
          <span className={`shrink-0 text-xs font-semibold ${only.available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {only.available} disp.
          </span>
        )}
      </div>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-left text-sm transition-colors hover:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-violet-500"
      >
        <Swatch colorHex={selected?.colorHex ?? null} />
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? 'Selecione a cor'}</span>
        <span className={`shrink-0 text-xs font-semibold ${selected && selected.available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {selected?.available ?? 0} disp.
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>

      {mounted && open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          >
            <div className="grid gap-2 p-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="font-display text-sm font-semibold">Escolher cor</h3>
                <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {options.map((o) => {
                  const isZero = o.available <= 0
                  return (
                    <button
                      key={o.key}
                      type="button"
                      disabled={isZero}
                      onClick={() => { onChange(o.key); setOpen(false) }}
                      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        o.key === value
                          ? 'border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10'
                          : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                      } ${isZero ? 'cursor-not-allowed opacity-40' : ''}`}
                    >
                      <Swatch colorHex={o.colorHex} className="h-4 w-4" />
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      <span className={`shrink-0 text-xs font-medium ${isZero ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {isZero ? 'sem estoque' : `${o.available} disp.`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
