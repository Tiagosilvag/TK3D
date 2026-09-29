'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ProductSelectOption {
  id: string
  name: string
}

// Melhoria "busca no seletor de produto": mesmo padrão de
// components/FilamentSelect.tsx -- um <select> nativo fica difícil de
// navegar quando o catálogo de produtos cresce (rolar opção por opção),
// então vira um botão que abre um painel de busca + lista. `name` opcional
// gera um <input type="hidden"> pra submissão nativa.
//
// Duas formas de usar, mesma dualidade do <select> nativo: controlado
// (`value`+`onChange`, formulário client precisa reagir à escolha -- ex.:
// trocar produto recarrega peças/variantes) ou não-controlado
// (`defaultValue`, formulário GET server-rendered com botão "Filtrar" --
// mesmo padrão de defaultValue em <select>/<input> nativo, sem precisar
// virar Client Component só pra guardar 1 campo).
//
// `emptyLabel` (opcional): pseudo-opção extra no topo ("Todos", value btw)
// pra filtro que aceita "nenhum produto selecionado" -- generaliza o
// <option value="">Todos</option> que <select> nativo já suportava.
//
// Portar pro <dialog> ancestral (closest('dialog')) em vez de <body> --
// mesma correção documentada em FilamentSelect.tsx/ComboSelect.tsx pro bug
// de dois <dialog> empilhados na "top layer" do navegador.
export function ProductSelect({
  name,
  options,
  value,
  defaultValue,
  onChange,
  emptyLabel,
  placeholder = 'Selecione',
  className = 'tk-input-full',
  disabled = false,
}: {
  name?: string
  options: ProductSelectOption[]
  value?: string
  defaultValue?: string
  onChange?: (id: string) => void
  emptyLabel?: string
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = useState(defaultValue ?? '')
  const currentValue = isControlled ? value : internalValue

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!pickerOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [pickerOpen])

  const allOptions = emptyLabel ? [{ id: '', name: emptyLabel }, ...options] : options
  const selected = allOptions.find((o) => o.id === currentValue) ?? null
  const term = search.trim().toLowerCase()
  const visible = term
    ? allOptions.filter((o) => o.name.toLowerCase().includes(term))
    : allOptions

  function openPicker() {
    setSearch('')
    setPickerOpen(true)
  }
  function pick(id: string) {
    if (!isControlled) setInternalValue(id)
    onChange?.(id)
    setPickerOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        disabled={disabled}
        className={`flex items-center justify-between gap-2 text-left ${disabled ? 'opacity-60' : ''} ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-slate-400 dark:text-slate-500'}`}>{selected ? selected.name : placeholder}</span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>
      {name && <input type="hidden" name={name} value={currentValue} />}
      {mounted && pickerOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setPickerOpen(false)}>
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          >
            <div className="flex max-h-[70vh] flex-col">
              <div className="border-b border-slate-200 p-3 dark:border-slate-800">
                <input
                  autoFocus
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar produto..."
                  className="tk-input-full"
                />
              </div>
              <div className="overflow-y-auto p-2">
                {visible.length === 0 ? (
                  <p className="px-2 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum produto encontrado.</p>
                ) : (
                  visible.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => pick(o.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${o.id === currentValue ? 'bg-violet-50 dark:bg-violet-500/10' : ''}`}
                    >
                      <span className="truncate">{o.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>,
        triggerRef.current?.closest('dialog') ?? document.body,
      )}
    </>
  )
}
