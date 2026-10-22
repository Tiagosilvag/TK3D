'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FilamentPicker, MaterialTag, Swatch } from '@/components/FilamentPicker'
import { splitColorName, type PickerFilament } from '@/lib/filamentPicker'

export interface FilamentSelectOption {
  id: string
  name: string
  colorHex: string | null
  // Campos estruturados do cadastro (lib/filamentPicker.ts#toFilamentSelectOption)
  // -- o seletor novo agrupa/filtra por eles. Ausentes (opção montada à
  // mão), cai no `name` inteiro como nome da cor.
  manufacturer?: string
  material?: string
  colorName?: string
  stockGrams?: number
}

// Opção usada pelos formulários de produto/produção: o seletor + preço por grama.
export type FilamentFormOption = FilamentSelectOption & { pricePerGram: number }

function toPickerFilament(o: FilamentSelectOption): PickerFilament {
  return {
    id: o.id,
    manufacturer: o.manufacturer ?? '',
    material: o.material ?? 'OUTRO',
    colorName: o.colorName ?? o.name,
    colorHex: o.colorHex,
    stockGrams: o.stockGrams ?? 0,
  }
}

// Seletor de filamento ÚNICO do app (Produto, Produção, edição): cartões
// por família de cor, tipo PLA/PETG, filtros de marca/acabamento, busca
// sem acento, teclado e cobertura de estoque -- ver FilamentPicker.tsx. O
// painel continua sendo portado pro <dialog> ancestral (explicação abaixo).

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
  need = 0,
  contextIds = [],
  contextLabel,
}: {
  name?: string
  options: FilamentSelectOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  // Gramas necessárias nesta escolha (g/un × planejada); 0 = não se aplica.
  need?: number
  // Outras cores da mesma peça (definem PLA/PETG padrão do seletor).
  contextIds?: string[]
  contextLabel?: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pickerFilaments = useMemo(() => options.map(toPickerFilament), [options])

  useEffect(() => setMounted(true), [])

  const selected = options.find((o) => o.id === value) ?? null
  const split = selected ? splitColorName(selected.colorName ?? selected.name) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={disabled}
        className={`flex items-center justify-between gap-2 text-left ${disabled ? 'opacity-60' : ''} ${className}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected && split ? (
            <>
              <Swatch item={{ colorHex: selected.colorHex, finish: split.finish }} className="h-5 w-5" />
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                <span className="truncate font-medium">{split.color}{split.finish !== 'Comum' ? ` ${split.finish}` : ''}</span>
                {selected.material && <MaterialTag material={selected.material} />}
                {selected.manufacturer && <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">{selected.manufacturer}</span>}
              </span>
            </>
          ) : (
            <span className="truncate text-slate-400 dark:text-slate-500">{placeholder}</span>
          )}
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>
      {name && <input type="hidden" name={name} value={value} />}
      {mounted && pickerOpen && createPortal(
        <FilamentPicker
          filaments={pickerFilaments}
          mode="single"
          selectedId={value || null}
          need={need}
          contextIds={contextIds}
          contextLabel={contextLabel}
          onPick={(ids) => { onChange(ids[0]); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
        />,
        triggerRef.current?.closest('dialog') ?? document.body,
      )}
    </>
  )
}

// "+ Adicionar outra cor": mesmo seletor em modo de marcação múltipla --
// marca várias, confirma uma vez, o pai cria uma linha por cor escolhida.
export function AddColorsButton({
  options,
  onAdd,
  contextIds = [],
  contextLabel,
  className,
  children,
}: {
  options: FilamentSelectOption[]
  onAdd: (ids: string[]) => void
  contextIds?: string[]
  contextLabel?: string
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pickerFilaments = useMemo(() => options.map(toPickerFilament), [options])
  useEffect(() => setMounted(true), [])

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {mounted && open && createPortal(
        <FilamentPicker
          filaments={pickerFilaments}
          mode="multi"
          contextIds={contextIds}
          contextLabel={contextLabel}
          onPick={(ids) => { onAdd(ids); setOpen(false) }}
          onClose={() => setOpen(false)}
        />,
        triggerRef.current?.closest('dialog') ?? document.body,
      )}
    </>
  )
}
