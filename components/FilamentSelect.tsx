'use client'
import { useRef, useState } from 'react'

export interface FilamentSelectOption {
  id: string
  name: string
  colorHex: string | null
}

// Melhoria "Filamento com bolinha de cor": um <select> nativo não permite
// nenhum elemento (nem um <span> colorido) dentro de <option> -- só texto
// puro, em qualquer browser. Pra mostrar a mesma bolinha de cor que já
// aparece no cadastro do filamento (Filamentos, Montagem, Estoque...), o
// campo vira um botão que abre um <dialog> nativo (mesmo padrão zero-lib
// de ComponentCategoryCard.tsx) com busca + lista, cada linha com a
// bolinha de verdade. Value/onChange controlado como qualquer outro campo
// do formulário; `name` opcional gera um <input type="hidden"> pra
// submissão nativa (mesmo padrão de components/HoursInput.tsx) -- quando
// ausente (ex.: linha de peça multi-filamento, serializada à parte em
// partsJson), o pai só lê `value`/`onChange` direto.
export function FilamentSelect({
  name,
  options,
  value,
  onChange,
  placeholder = 'Selecione',
  className = 'tk-input-full',
}: {
  name?: string
  options: FilamentSelectOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [search, setSearch] = useState('')
  const selected = options.find((o) => o.id === value) ?? null
  const term = search.trim().toLowerCase()
  const visible = term ? options.filter((o) => o.name.toLowerCase().includes(term)) : options

  function open() {
    setSearch('')
    dialogRef.current?.showModal()
  }
  function close() {
    dialogRef.current?.close()
  }
  function pick(id: string) {
    onChange(id)
    close()
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={`flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.colorHex && <span style={{ background: selected.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
          <span className={`truncate ${selected ? '' : 'text-slate-400 dark:text-slate-500'}`}>{selected ? selected.name : placeholder}</span>
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      <dialog
        ref={dialogRef}
        onClick={(e) => { if (e.target === dialogRef.current) close() }}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex max-h-[70vh] flex-col">
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar filamento..."
              className="tk-input-full"
            />
          </div>
          <div className="overflow-y-auto p-2">
            {visible.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum filamento encontrado.</p>
            ) : (
              visible.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => pick(o.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${o.id === value ? 'bg-amber-50 dark:bg-amber-500/10' : ''}`}
                >
                  {o.colorHex ? (
                    <span style={{ background: o.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />
                  ) : (
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300 dark:border-slate-600" />
                  )}
                  <span className="truncate">{o.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </dialog>
    </>
  )
}
