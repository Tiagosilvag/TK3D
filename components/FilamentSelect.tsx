'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface FilamentSelectOption {
  id: string
  name: string
  colorHex: string | null
}

// Melhoria "Filamento com bolinha de cor": um <select> nativo não permite
// nenhum elemento (nem um <span> colorido) dentro de <option> -- só texto
// puro, em qualquer browser. Pra mostrar a mesma bolinha de cor que já
// aparece no cadastro do filamento (Filamentos, Montagem, Estoque...), o
// campo vira um botão que abre um painel de busca + lista, cada linha com
// a bolinha de verdade. Value/onChange controlado como qualquer outro campo
// do formulário; `name` opcional gera um <input type="hidden"> pra
// submissão nativa (mesmo padrão de components/HoursInput.tsx) -- quando
// ausente (ex.: linha de peça multi-filamento, serializada à parte em
// partsJson), o pai só lê `value`/`onChange` direto.
//
// Bug "modal fecha ao selecionar filamento" (2ª volta): a 1ª tentativa de
// corrigir isso portava o painel pra <body> via createPortal, mas MANTINHA
// ele como um <dialog> nativo próprio (showModal()) -- só que portar pro
// <body> não muda nada sobre o bug real: dois <dialog> de verdade, cada um
// com seu showModal(), empilham na "top layer" do navegador
// INDEPENDENTEMENTE de onde vivem na árvore do DOM. Fechar o de CIMA (este
// seletor, ao escolher um filamento) ainda dispara um evento 'close' nativo
// espúrio no de BAIXO (a modal de "Novo produto"), fechando os dois --
// confirmado ao vivo (mesmo bug documentado em ComponentCategoryCard.tsx,
// que já passou por essa mesma correção). Fix de verdade: este painel
// deixa de ser <dialog>/showModal() -- vira um painel comum controlado por
// estado React (backdrop + painel, Esc/clique-fora fecham via listener).
//
// Bug "nem abre pra selecionar" (3ª volta): a correção acima portava esse
// painel pra <body> -- mas <body> não é descendente do <dialog> nativo da
// modal de "Novo produto" (que continua aberta por baixo, via showModal()),
// e um <dialog> modal pinta na "top layer" por CIMA de QUALQUER outro
// conteúdo da página, independente de z-index (mesma causa raiz já corrigida
// em ComboSelect.tsx/ComponentCategoryCard.tsx pra esse exato padrão) --
// então o painel ficava escondido atrás do próprio modal E com clique
// bloqueado por ele. Portar pro <dialog> ancestral (closest('dialog') a
// partir do botão que abre o painel) em vez de <body> resolve -- painel
// continua descendente do modal, na mesma top layer, clicável de verdade.
// Cai de volta pro <body> se usado fora de um <dialog> (nenhum caso hoje).
export function FilamentSelect({
  name,
  options,
  value,
  onChange,
  placeholder = 'Selecione',
  className = 'tk-input-full',
  disabled = false,
}: {
  name?: string
  options: FilamentSelectOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
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

  const selected = options.find((o) => o.id === value) ?? null
  const term = search.trim().toLowerCase()
  const visible = term ? options.filter((o) => o.name.toLowerCase().includes(term)) : options

  function openPicker() {
    setSearch('')
    setPickerOpen(true)
  }
  function pick(id: string) {
    onChange(id)
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
        <span className="flex min-w-0 items-center gap-2">
          {selected?.colorHex && <span style={{ background: selected.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
          <span className={`truncate ${selected ? '' : 'text-slate-400 dark:text-slate-500'}`}>{selected ? selected.name : placeholder}</span>
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>
      {name && <input type="hidden" name={name} value={value} />}
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
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${o.id === value ? 'bg-violet-50 dark:bg-violet-500/10' : ''}`}
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
          </div>
        </div>,
        triggerRef.current?.closest('dialog') ?? document.body,
      )}
    </>
  )
}
