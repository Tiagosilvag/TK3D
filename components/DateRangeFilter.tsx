// 3.1 Filtro por período: form GET simples (sem JS), mesmo padrão já usado
// no filtro de produção do Dashboard. `hiddenParams` preserva outros
// filtros da própria tela (ex.: canal, tipo) ao submeter.
export function DateRangeFilter({
  action,
  from,
  to,
  hiddenParams = {},
}: {
  action: string
  from: string
  to: string
  hiddenParams?: Record<string, string | undefined>
}) {
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-3 tk-panel p-3">
      {Object.entries(hiddenParams).map(([key, value]) => (value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
        De
        <input type="date" name="from" defaultValue={from} className="tk-input-full mt-1" />
      </label>
      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
        Até
        <input type="date" name="to" defaultValue={to} className="tk-input-full mt-1" />
      </label>
      <button type="submit" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white dark:bg-amber-500 dark:text-slate-950">
        Filtrar
      </button>
      <a href={action} className="text-sm font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400">
        Últimos 30 dias
      </a>
    </form>
  )
}
