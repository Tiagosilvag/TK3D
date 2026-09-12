'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ComponentOption {
  id: string
  name: string
  colorName?: string
  unit?: string
  available: number
  // Insumos §5: "Uso padrão" cadastrado no catálogo (Supply.defaultUsage) --
  // usado só como valor inicial de uma linha ADICIONADA extra por aqui
  // (a linha pré-preenchida da ficha técnica já tem seu próprio valor,
  // ver `defaultQuantityPerUnit` em ComponentRow).
  catalogDefaultUsage?: number | null
}

export interface ComponentRow {
  id: string
  quantityPerUnit: string
  // Valor registrado na ficha técnica do produto -- mostrado como "Padrão:
  // X" ao lado do campo editável, nunca reescrito por essa tela (só a
  // quantidade USADA NESTA LEVA, em `quantityPerUnit`, muda).
  defaultQuantityPerUnit: number
}

function optionLabel(o: ComponentOption): string {
  return o.colorName ? `${o.name} — ${o.colorName}` : o.name
}

// Melhoria "Montagem" §5: card de UMA categoria de componente (Acessórios/
// Insumos/Embalagem) -- cada linha pré-preenchida da ficha técnica ganha um
// dropdown de VARIAÇÃO (outros itens com o mesmo nome-base, ex.: Corrente
// Bolinha Dourada/Prata -- só existe eixo de variação de verdade pra
// Acessório, que tem colorName; Insumo/Embalagem mostram um select de 1
// opção só, mesmo padrão visual) + "Uso padrão" (a quantidade já registrada
// na ficha técnica) + quantidade editável pra esta leva específica.
// `readOnly` (só Embalagem usa) desliga a edição -- mostrado por
// completude/visibilidade da ficha técnica, mas nunca consumido na
// Montagem (continua só na Venda, ver actions/sales.ts).
export function ComponentCategoryCard({
  label,
  rows,
  onChange,
  options,
  readOnly = false,
}: {
  label: string
  rows: ComponentRow[]
  onChange: (rows: ComponentRow[]) => void
  options: ComponentOption[]
  readOnly?: boolean
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  // Bug "modal de Montagem fecha ao adicionar acessório": este picker
  // vivia num <dialog> nativo próprio, aberto via showModal() enquanto
  // AssemblyDetailModal já tinha SEU PRÓPRIO <dialog> aberto -- portar o
  // DOM pra <body> (ver ComponentsSection/FilamentSelect) resolve o
  // aninhamento no React tree, mas dois <dialog> nativos empilhados
  // (cada um seu próprio showModal()) têm um bug real de stacking em
  // Chrome recente: fechar o de CIMA (este picker, via close()) dispara
  // um evento 'close' nativo espúrio no de BAIXO (AssemblyDetailModal)
  // também, derrubando a montagem em andamento -- confirmado ao vivo
  // (Playwright + build local), não é elemento aninhado no React nem bug
  // de portal. Fix: este picker deixa de ser <dialog>/showModal() -- vira
  // um painel comum controlado por estado React (backdrop + painel,
  // Esc/clique-fora fecham via listener), portado pra <body> só pra
  // escapar de overflow/clipping de ancestrais, igual ActionsMenu.
  useEffect(() => {
    if (!pickerOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [pickerOpen])

  function updateRow(index: number, patch: Partial<ComponentRow>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }
  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }
  function addOption(option: ComponentOption) {
    onChange([...rows, { id: option.id, quantityPerUnit: String(option.catalogDefaultUsage ?? 1), defaultQuantityPerUnit: option.catalogDefaultUsage ?? 1 }])
    setPickerOpen(false)
    setSearch('')
  }

  const usedIds = new Set(rows.map((r) => r.id))
  const pickerOptions = options.filter((o) => !usedIds.has(o.id) && optionLabel(o).toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="tk-panel p-4">
      <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const selected = options.find((o) => o.id === row.id)
            // Variação = outros itens com o MESMO nome-base (ex.: mesma
            // Corrente Bolinha em cores diferentes) -- pra Insumo/
            // Embalagem (sem colorName) isso é sempre só o item em si.
            const variants = selected ? options.filter((o) => o.name === selected.name) : []
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <select
                  value={row.id}
                  onChange={(e) => updateRow(i, { id: e.target.value })}
                  className="tk-input flex-1"
                  disabled={readOnly}
                >
                  {variants.map((o) => (
                    <option key={o.id} value={o.id}>{optionLabel(o)}</option>
                  ))}
                </select>
                <span className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
                  Padrão: {row.defaultQuantityPerUnit}{selected?.unit ? selected.unit.toLowerCase() : 'un'}
                </span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={row.quantityPerUnit}
                  onChange={(e) => updateRow(i, { quantityPerUnit: e.target.value })}
                  className="tk-input w-20"
                  disabled={readOnly}
                />
                <span className={`whitespace-nowrap text-xs ${selected && selected.available < (parseFloat(row.quantityPerUnit) || 0) ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {selected?.available ?? 0} disp.
                </span>
                {!readOnly && (
                  <button type="button" onClick={() => removeRow(i)} className="tk-link-danger text-xs">Remover</button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="mt-3 w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60"
      >
        + Adicionar {label.toLowerCase().replace(/s$/, '')}
      </button>

      {mounted && pickerOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setPickerOpen(false)}>
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          >
            <div className="grid gap-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold">Adicionar {label.toLowerCase()}</h3>
                <button type="button" onClick={() => setPickerOpen(false)} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar"
                className="tk-input-full"
                autoFocus
              />
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {pickerOptions.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">Nada encontrado.</p>
                ) : (
                  pickerOptions.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => addOption(o)}
                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-violet-400 dark:border-slate-700 dark:hover:border-violet-500"
                    >
                      {optionLabel(o)}
                      <span className="text-slate-400">{o.available} disp.</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
