'use client'
import { useRef, useState } from 'react'
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

// "0" é o valor que a Anycubic manda pra end_time de uma impressão ainda em
// andamento (ainda não terminou) -- tratado como "sem data" igual null,
// senão vira epoch (1970-01-01 UTC = 31/12/1969 21h em GMT-3).
function formatUnixSeconds(seconds: number | null): string | null {
  if (!seconds) return null
  return new Date(seconds * 1000).toLocaleString('pt-BR')
}

// Mesma fórmula de luminância percebida usada em LiveStatusPoller.tsx --
// texto branco sobre badge de cor clara (ex.: filamento branco) fica
// ilegível, então escolhe preto ou branco pelo brilho da cor de fundo.
function readableTextColor(hex: string): string {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) return '#ffffff'
  const [r, g, b] = match.slice(1).map((c) => parseInt(c, 16))
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0f172a' : '#ffffff'
}

export function ProjectHistoryList({ initialTasks, initialNextPage }: { initialTasks: Tasks; initialNextPage: number | null }) {
  const [tasks, setTasks] = useState(initialTasks ?? [])
  const [nextPage, setNextPage] = useState(initialNextPage)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null)
  const imageDialogRef = useRef<HTMLDialogElement>(null)

  function openImage(url: string) {
    setEnlargedImage(url)
    imageDialogRef.current?.showModal()
  }

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
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {tasks.map((task) => {
        const statusInfo = task.printStatus !== null ? STATUS_LABELS[task.printStatus] : undefined
        const totalGrams = task.materialBreakdown?.reduce((sum, m) => sum + m.grams, 0) ?? null
        return (
          <div key={task.id} className="tk-panel flex gap-3 p-4">
            {task.thumbnailUrl ? (
              <button type="button" onClick={() => openImage(task.thumbnailUrl!)} className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={task.thumbnailUrl} alt={task.gcodeName ?? 'Impressão'} className="h-16 w-16 rounded-lg object-cover" />
              </button>
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
              {task.materialBreakdown && task.materialBreakdown.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {task.materialBreakdown.map((material, i) => {
                    const bg = material.colorHex ?? '#64748b'
                    return (
                      <span
                        key={i}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-xs font-medium dark:border-slate-600"
                        style={{ backgroundColor: bg, color: readableTextColor(bg) }}
                      >
                        {material.materialType} {material.grams}g
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })}
      </div>

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

      <dialog
        ref={imageDialogRef}
        onClose={() => setEnlargedImage(null)}
        className="max-w-2xl rounded-xl border border-slate-200 bg-white p-2 backdrop:bg-slate-950/70 dark:border-slate-800 dark:bg-slate-900"
      >
        {enlargedImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={enlargedImage} alt="Impressão (ampliado)" className="max-h-[80vh] w-full rounded-lg object-contain" />
        )}
        <button
          type="button"
          onClick={() => imageDialogRef.current?.close()}
          className="mt-2 w-full rounded-lg border border-slate-300 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Fechar
        </button>
      </dialog>
    </div>
  )
}
