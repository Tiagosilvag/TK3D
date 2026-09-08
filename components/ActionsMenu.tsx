// 5.2: linhas com vários botões de texto soltos (Editar / Ajustar estoque /
// Excluir...) viram um menu "⋯" -- usa <details>/<summary> nativo (mesmo
// espírito de zero-dependência do resto do app), então continua um Server
// Component: nenhuma das ações que passam por aqui como children precisa
// virar Client Component por causa do menu em si.
export function ActionsMenu({ children }: { children: React.ReactNode }) {
  return (
    <details className="group relative inline-block">
      <summary
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label="Ações"
      >
        ⋯
      </summary>
      <div className="absolute right-0 z-10 mt-1 flex min-w-max flex-col items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        {children}
      </div>
    </details>
  )
}
