'use client'
import { useState } from 'react'
import { getAnycubicProjectHistory } from '@/actions/anycubicStatus'

type Tasks = Awaited<ReturnType<typeof getAnycubicProjectHistory>>['tasks']

// Valor bruto de AnycubicPrintStatus visto no código de referência (1=
// Printing, 2=Complete, 3=Cancelled, 4=Downloading, 5=Checking,
// 6=Preheating, 7=Slicing) -- só os terminais/relevantes pro histórico
// ganham rótulo, o resto mostra o número cru.
const STATUS_LABELS: Record<number, { label: string; className: string }> = {
  2: { label: 'Concluída', className: 'text-emerald-600 dark:text-emerald-400' },
  3: { label: 'Cancelada', className: 'text-red-600 dark:text-red-400' },
  1: { label: 'Imprimindo', className: 'text-violet-600 dark:text-violet-400' },
}

function formatMinutes(minutes: number | null): string | null {
  if (minutes === null) return null
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return hours > 0 ? `${hours}h${mins}min` : `${mins}min`
}

function formatUnixSeconds(seconds: number | null): string | null {
  if (seconds === null) return null
  return new Date(seconds * 1000).toLocaleString('pt-BR')
}

export function ProjectHistoryList({ initialTasks, initialNextPage }: { initialTasks: Tasks; initialNextPage: number | null }) {
  const [tasks, setTasks] = useState(initialTasks ?? [])
  const [nextPage, setNextPage] = useState(initialNextPage)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadMore() {
    if (!nextPage) return
    setLoading(true)
    setError(null)
    const result = await getAnycubicProjectHistory(nextPage)
    setLoading(false)
    if (!result.success) {
      setError(result.error ?? 'Falha ao carregar mais')
      return
    }
    setTasks((current) => [...current, ...(result.tasks ?? [])])
    setNextPage(result.nextPage ?? null)
  }

  if (tasks.length === 0) {
    return <div className="tk-panel p-4 text-sm text-slate-500 dark:text-slate-400">Nenhuma impressão no histórico da conta ainda.</div>
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => {
        const statusInfo = task.printStatus !== null ? STATUS_LABELS[task.printStatus] : undefined
        const totalGrams = task.materialBreakdown?.reduce((sum, m) => sum + m.grams, 0) ?? null
        return (
          <div key={task.id} className="tk-panel flex gap-3 p-4">
            {task.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={task.thumbnailUrl} alt={task.gcodeName ?? 'Impressão'} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg dark:bg-slate-800">🖨️</div>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium text-slate-900 dark:text-slate-100">{task.gcodeName ?? 'Sem título'}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{task.printerName ?? '—'}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                {statusInfo ? (
                  <span className={statusInfo.className}>{statusInfo.label}</span>
                ) : task.printStatus !== null ? (
                  <span>Status {task.printStatus}</span>
                ) : null}
                {totalGrams !== null && <span>{Math.round(totalGrams * 10) / 10}g</span>}
                {formatMinutes(task.printTimeMinutes) && <span>{formatMinutes(task.printTimeMinutes)}</span>}
                {formatUnixSeconds(task.endTime) && <span>{formatUnixSeconds(task.endTime)}</span>}
              </div>
              {task.modelDimensions && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{task.modelDimensions}</p>}
            </div>
          </div>
        )
      })}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {nextPage && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400"
        >
          {loading ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}
