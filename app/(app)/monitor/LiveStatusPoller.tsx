'use client'
import { useEffect, useRef, useState } from 'react'
import { getAllLiveBambuStatuses } from '@/actions/bambuStatus'
import { pausePrintJob, resumePrintJob, stopPrintJob } from '@/actions/bambuControl'

type LiveStatuses = Awaited<ReturnType<typeof getAllLiveBambuStatuses>>

const PAUSABLE_STATES = new Set(['RUNNING'])
const RESUMABLE_STATES = new Set(['PAUSE'])
const STOPPABLE_STATES = new Set(['RUNNING', 'PAUSE', 'PREPARE'])

function PrintControls({ printerId, printerName, gcodeState }: { printerId: string; printerName: string; gcodeState: string }) {
  const [pending, setPending] = useState<'pause' | 'resume' | 'stop' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  async function run(kind: 'pause' | 'resume' | 'stop', fn: (id: string) => Promise<{ success: boolean; error?: string }>) {
    setPending(kind)
    setError(null)
    const result = await fn(printerId)
    setPending(null)
    if (!result.success) setError(result.error ?? 'Falha ao enviar comando')
    else dialogRef.current?.close()
  }

  const canPause = PAUSABLE_STATES.has(gcodeState)
  const canResume = RESUMABLE_STATES.has(gcodeState)
  const canStop = STOPPABLE_STATES.has(gcodeState)

  if (!canPause && !canResume && !canStop) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {canPause && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => run('pause', pausePrintJob)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {pending === 'pause' ? 'Pausando…' : 'Pausar'}
        </button>
      )}
      {canResume && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => run('resume', resumePrintJob)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {pending === 'resume' ? 'Retomando…' : 'Retomar'}
        </button>
      )}
      {canStop && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => dialogRef.current?.showModal()}
          className="rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Parar
        </button>
      )}
      {error && <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}

      <dialog
        ref={dialogRef}
        className="w-96 rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="grid gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Parar impressão em &ldquo;{printerName}&rdquo;?</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Essa ação não pode ser desfeita — a peça em andamento será perdida.</p>
          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => run('stop', stopPrintJob)}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:text-slate-950 dark:hover:bg-red-400"
            >
              {pending === 'stop' ? 'Parando…' : 'Parar impressão'}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}

const STATE_LABELS: Record<string, string> = {
  RUNNING: 'Imprimindo',
  IDLE: 'Ocioso',
  PAUSE: 'Pausado',
  FAILED: 'Falhou',
  PREPARE: 'Preparando',
  FINISH: 'Concluído',
}

const SPEED_LABELS: Record<number, string> = {
  1: 'Silencioso',
  2: 'Normal',
  3: 'Esportivo',
  4: 'Ludicrous',
}

function formatTemp(current: number | null, target: number | null): string | null {
  if (current === null) return null
  return target !== null && target > 0 ? `${current}°C (alvo ${target}°C)` : `${current}°C`
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
      {printers.map((printer) => {
        const status = printer.status
        return (
          <div key={printer.printerId} className="tk-panel flex gap-3 p-4">
            {printer.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={printer.thumbnailUrl}
                alt="Modelo em impressão"
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{printer.name}</h3>
            {!status ? (
              <p className="mt-2 text-sm text-slate-400">Sem dados ainda</p>
            ) : (
              <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                <p>{STATE_LABELS[status.gcodeState] ?? status.gcodeState}</p>
                {status.percent !== null && <p>{status.percent}%</p>}
                {status.remainingMinutes !== null && <p>{status.remainingMinutes} min restantes</p>}
                {status.gcodeFilePreparePercent !== null && status.gcodeFilePreparePercent < 100 && (
                  <p className="text-slate-500 dark:text-slate-400">Preparando arquivo: {status.gcodeFilePreparePercent}%</p>
                )}
                {status.gcodeFile && <p className="truncate text-slate-500 dark:text-slate-400">{status.gcodeFile}</p>}

                <PrintControls printerId={printer.printerId} printerName={printer.name} gcodeState={status.gcodeState} />

                {status.hmsCodes.length > 0 && (
                  <p className="text-red-600 dark:text-red-400">Alerta HMS: {status.hmsCodes.join(', ')}</p>
                )}
                {status.printErrorCode && <p className="text-red-600 dark:text-red-400">Erro: {status.printErrorCode}</p>}

                {status.amsTrays.length > 0 && (
                  <div className="pt-1">
                    {status.amsTrays.map((tray) => (
                      <p key={tray.id} className="text-xs text-slate-500 dark:text-slate-400">
                        Slot {tray.id}: {tray.type || '—'} · {tray.remainPercent}%{' '}
                        {tray.tagUid && tray.tagUid !== '0000000000000000' ? '(rolo Bambu)' : '(rolo genérico)'}
                      </p>
                    ))}
                  </div>
                )}

                <details className="pt-1">
                  <summary className="tk-summary cursor-pointer text-xs">Detalhes</summary>
                  <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formatTemp(status.nozzleTemp, status.nozzleTargetTemp) && <p>Bico: {formatTemp(status.nozzleTemp, status.nozzleTargetTemp)}</p>}
                    {formatTemp(status.bedTemp, status.bedTargetTemp) && <p>Mesa: {formatTemp(status.bedTemp, status.bedTargetTemp)}</p>}
                    {status.chamberTemp !== null && <p>Câmara: {status.chamberTemp}°C</p>}
                    {status.speedLevel !== null && <p>Velocidade: {SPEED_LABELS[status.speedLevel] ?? status.speedLevel}</p>}
                    {status.fanSpeeds.cooling !== null && <p>Ventoinha peça: {status.fanSpeeds.cooling}</p>}
                    {status.fanSpeeds.heatbreak !== null && <p>Ventoinha hotend: {status.fanSpeeds.heatbreak}</p>}
                    {status.wifiSignal && <p>Wi-Fi: {status.wifiSignal}</p>}
                    {status.nozzleDiameter && <p>Bico instalado: {status.nozzleDiameter}mm {status.nozzleType ?? ''}</p>}
                    {status.firmwareVersion && <p>Firmware: {status.firmwareVersion}</p>}
                  </div>
                </details>
              </div>
            )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
