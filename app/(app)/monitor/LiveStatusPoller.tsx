'use client'
import { useEffect, useRef, useState } from 'react'
import { getAllLiveStatuses } from '@/actions/bambuStatus'
import { pausePrintJob, resumePrintJob, stopPrintJob } from '@/actions/bambuControl'

type LiveStatuses = Awaited<ReturnType<typeof getAllLiveStatuses>>

const PAUSABLE_STATES = new Set(['RUNNING'])
const RESUMABLE_STATES = new Set(['PAUSE'])
const STOPPABLE_STATES = new Set(['RUNNING', 'PAUSE', 'PREPARE'])

function PrintControls({ printerId, printerName, gcodeState }: { printerId: string; printerName: string; gcodeState: string }) {
  const [pending, setPending] = useState<'pause' | 'resume' | 'stop' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Bug fix: LiveStatusPoller re-renders this component every 4s with a
  // fresh gcodeState from the poll. If the print finishes/errors out
  // (state leaves the pausable/resumable/stoppable sets) while the "Parar
  // impressão?" confirmation dialog is open, the early `return null` below
  // used to unmount this whole subtree -- yanking the open dialog (and its
  // pending/error state) out from under the user mid-confirmation. Tracking
  // whether the dialog is actually open keeps it (and this component)
  // mounted until the user closes it themselves.
  const [dialogOpen, setDialogOpen] = useState(false)

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

  if (!canPause && !canResume && !canStop && !dialogOpen) return null

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
          onClick={() => { setDialogOpen(true); dialogRef.current?.showModal() }}
          className="rounded-lg border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Parar
        </button>
      )}
      {error && <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>}

      <dialog
        ref={dialogRef}
        onClose={() => setDialogOpen(false)}
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

const ANYCUBIC_STATE_LABELS: Record<string, string> = {
  IDLE: 'Ocioso',
  DOWNLOADING: 'Baixando arquivo',
  CHECKING: 'Verificando',
  PREHEATING: 'Preaquecendo',
  PRINTING: 'Imprimindo',
  PAUSED: 'Pausado',
  FINISHED: 'Concluído',
  CANCELLED: 'Cancelado',
}

export function LiveStatusPoller({ initialPrinters }: { initialPrinters: LiveStatuses }) {
  const [printers, setPrinters] = useState(initialPrinters)

  useEffect(() => {
    const interval = setInterval(async () => {
      setPrinters(await getAllLiveStatuses())
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {printers.map((printer) => (
        <div key={printer.printerId} className="tk-panel flex gap-3 p-4">
          {printer.brand === 'bambu' && printer.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={printer.thumbnailUrl}
              alt="Modelo em impressão"
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{printer.name}</h3>
            {printer.brand === 'bambu' ? (
              !printer.status ? (
                <p className="mt-2 text-sm text-slate-400">Sem dados ainda</p>
              ) : (
                <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <p>{STATE_LABELS[printer.status.gcodeState] ?? printer.status.gcodeState}</p>
                  {printer.status.percent !== null && <p>{printer.status.percent}%</p>}
                  {printer.status.remainingMinutes !== null && <p>{printer.status.remainingMinutes} min restantes</p>}
                  {printer.status.gcodeFilePreparePercent !== null && printer.status.gcodeFilePreparePercent < 100 && (
                    <p className="text-slate-500 dark:text-slate-400">Preparando arquivo: {printer.status.gcodeFilePreparePercent}%</p>
                  )}
                  {printer.status.gcodeFile && <p className="truncate text-slate-500 dark:text-slate-400">{printer.status.gcodeFile}</p>}

                  <PrintControls printerId={printer.printerId} printerName={printer.name} gcodeState={printer.status.gcodeState} />

                  {printer.status.hmsCodes.length > 0 && (
                    <p className="text-red-600 dark:text-red-400">Alerta HMS: {printer.status.hmsCodes.join(', ')}</p>
                  )}
                  {printer.status.printErrorCode && <p className="text-red-600 dark:text-red-400">Erro: {printer.status.printErrorCode}</p>}

                  {printer.status.amsTrays.length > 0 && (
                    <div className="pt-1">
                      {printer.status.amsTrays.map((tray) => (
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
                      {formatTemp(printer.status.nozzleTemp, printer.status.nozzleTargetTemp) && (
                        <p>Bico: {formatTemp(printer.status.nozzleTemp, printer.status.nozzleTargetTemp)}</p>
                      )}
                      {formatTemp(printer.status.bedTemp, printer.status.bedTargetTemp) && (
                        <p>Mesa: {formatTemp(printer.status.bedTemp, printer.status.bedTargetTemp)}</p>
                      )}
                      {printer.status.chamberTemp !== null && <p>Câmara: {printer.status.chamberTemp}°C</p>}
                      {printer.status.speedLevel !== null && <p>Velocidade: {SPEED_LABELS[printer.status.speedLevel] ?? printer.status.speedLevel}</p>}
                      {printer.status.fanSpeeds.cooling !== null && <p>Ventoinha peça: {printer.status.fanSpeeds.cooling}</p>}
                      {printer.status.fanSpeeds.heatbreak !== null && <p>Ventoinha hotend: {printer.status.fanSpeeds.heatbreak}</p>}
                      {printer.status.wifiSignal && <p>Wi-Fi: {printer.status.wifiSignal}</p>}
                      {printer.status.nozzleDiameter && (
                        <p>
                          Bico instalado: {printer.status.nozzleDiameter}mm {printer.status.nozzleType ?? ''}
                        </p>
                      )}
                      {printer.status.firmwareVersion && <p>Firmware: {printer.status.firmwareVersion}</p>}
                    </div>
                  </details>
                </div>
              )
            ) : !printer.status ? (
              <p className="mt-2 text-sm text-slate-400">Sem dados ainda</p>
            ) : (
              <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                <p>{ANYCUBIC_STATE_LABELS[printer.status.printState] ?? printer.status.printState}</p>
                {printer.status.progressPercent !== null && <p>{printer.status.progressPercent}%</p>}
                {printer.status.remainingMinutes !== null && <p>{printer.status.remainingMinutes} min restantes</p>}
                {printer.status.gcodeFile && <p className="truncate text-slate-500 dark:text-slate-400">{printer.status.gcodeFile}</p>}
                {printer.status.currentLayer !== null && printer.status.totalLayers !== null && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Camada {printer.status.currentLayer}/{printer.status.totalLayers}
                  </p>
                )}
                <details className="pt-1">
                  <summary className="tk-summary cursor-pointer text-xs">Detalhes</summary>
                  <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {printer.status.nozzleTemp !== null && <p>Bico: {printer.status.nozzleTemp}°C</p>}
                    {printer.status.bedTemp !== null && <p>Mesa: {printer.status.bedTemp}°C</p>}
                    {printer.status.fanSpeedPercent !== null && <p>Ventoinha: {printer.status.fanSpeedPercent}%</p>}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
