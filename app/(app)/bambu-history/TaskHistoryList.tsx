'use client'
import { useState } from 'react'
import { getBambuTaskHistory } from '@/actions/bambuStatus'

type Tasks = Awaited<ReturnType<typeof getBambuTaskHistory>>['tasks']

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  completed: { label: 'Concluída', className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Falhou', className: 'text-red-600 dark:text-red-400' },
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h${minutes}min` : `${minutes}min`
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR')
}

export function TaskHistoryList({ initialTasks, initialCursor }: { initialTasks: Tasks; initialCursor: string | null }) {
  const [tasks, setTasks] = useState(initialTasks ?? [])
  const [cursor, setCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadMore() {
    if (!cursor) return
    setLoading(true)
    setError(null)
    const result = await getBambuTaskHistory(cursor)
    setLoading(false)
    if (!result.success) {
      setError(result.error ?? 'Falha ao carregar mais')
      return
    }
    setTasks((current) => [...current, ...(result.tasks ?? [])])
    setCursor(result.nextCursor ?? null)
  }

  if (tasks.length === 0) {
    return <div className="tk-panel p-4 text-sm text-slate-500 dark:text-slate-400">Nenhuma impressão no histórico da conta ainda.</div>
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => {
        const statusInfo = STATUS_LABELS[task.status] ?? { label: task.status, className: 'text-slate-500 dark:text-slate-400' }
        return (
          <div key={task.id} className="tk-panel flex gap-3 p-4">
            {task.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={task.thumbnailUrl} alt={task.title ?? 'Impressão'} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg dark:bg-slate-800">🖨️</div>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium text-slate-900 dark:text-slate-100">{task.title ?? 'Sem título'}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{task.deviceName ?? '—'}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span className={statusInfo.className}>{statusInfo.label}</span>
                {task.weightGrams !== null && <span>{task.weightGrams.toFixed(1)}g</span>}
                {formatDuration(task.costTimeSeconds) && <span>{formatDuration(task.costTimeSeconds)}</span>}
                {formatDate(task.endTime) && <span>{formatDate(task.endTime)}</span>}
              </div>
            </div>
          </div>
        )
      })}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {cursor && (
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
