'use client'
import { useEffect, useState } from 'react'
import { getAllLiveBambuStatuses } from '@/actions/bambuStatus'

type LiveStatuses = Awaited<ReturnType<typeof getAllLiveBambuStatuses>>

const STATE_LABELS: Record<string, string> = {
  RUNNING: 'Imprimindo',
  IDLE: 'Ocioso',
  PAUSE: 'Pausado',
  FAILED: 'Falhou',
}

export function LiveStatusPoller({ initialPrinters }: { initialPrinters: LiveStatuses }) {
  const [printers, setPrinters] = useState(initialPrinters)

  useEffect(() => {
    const interval = setInterval(async () => {
      setPrinters(await getAllLiveBambuStatuses())
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {printers.map((printer) => (
        <div key={printer.printerId} className="tk-panel p-4">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{printer.name}</h3>
          {!printer.status ? (
            <p className="mt-2 text-sm text-slate-400">Sem dados ainda</p>
          ) : (
            <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              <p>{STATE_LABELS[printer.status.gcodeState] ?? printer.status.gcodeState}</p>
              {printer.status.percent !== null && <p>{printer.status.percent}%</p>}
              {printer.status.remainingMinutes !== null && <p>{printer.status.remainingMinutes} min restantes</p>}
              {printer.status.gcodeFile && <p className="truncate text-slate-500 dark:text-slate-400">{printer.status.gcodeFile}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
