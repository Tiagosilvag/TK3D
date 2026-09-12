'use client'
import { useState } from 'react'

// Melhoria "Acessórios" §6: dropdown customizado (não &lt;select&gt; nativo)
// pra poder encaixar "Gerenciar tipos..." como uma linha a mais na lista,
// separada por divisória, sem misturar com as opções reais de tipo.
// Overlay em tela cheia (z-index abaixo do painel) fecha o dropdown ao
// clicar fora -- mesmo truque simples já usado nesta base pra menus sem
// lib nova (ActionsMenu usa &lt;details&gt;/&lt;summary&gt;; aqui não dá porque
// "Gerenciar tipos..." precisa trocar o conteúdo do modal inteiro, não só
// fechar o próprio menu).
export function TypeSelect({
  types,
  value,
  onChange,
  onManage,
}: {
  types: { id: string; name: string }[]
  value: string
  onChange: (id: string) => void
  onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const selected = types.find((t) => t.id === value)

  return (
    <div className="relative">
      <input type="hidden" name="type" value={value} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`tk-input-full flex items-center justify-between text-left ${!selected ? 'text-slate-400 dark:text-slate-500' : ''}`}
      >
        {selected?.name ?? 'Selecione'}
        <span aria-hidden className="text-slate-400">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onChange(t.id); setOpen(false) }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${t.id === value ? 'font-medium text-violet-600 dark:text-violet-400' : 'text-slate-700 dark:text-slate-200'}`}
              >
                {t.name}
              </button>
            ))}
            {types.length === 0 && (
              <p className="px-3 py-1.5 text-sm text-slate-400 dark:text-slate-500">Nenhum tipo cadastrado.</p>
            )}
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <button
              type="button"
              onClick={() => { onManage(); setOpen(false) }}
              className="block w-full px-3 py-1.5 text-left text-sm text-violet-600 hover:bg-slate-100 dark:text-violet-400 dark:hover:bg-slate-800"
            >
              ⚙ Gerenciar tipos...
            </button>
          </div>
        </>
      )}
    </div>
  )
}
