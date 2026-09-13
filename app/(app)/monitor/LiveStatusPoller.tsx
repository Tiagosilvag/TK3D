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

// O supplies_usage que vem do MQTT se mostrou não confiável (visto em
// produção: reportou 64143g pra uma peça de ~202g reais) -- soma do
// consumo por cor de project/info é a fonte confirmada, usada aqui em vez
// disso pro total (mesmo número que o próprio Anycubic Slicer mostra).
function sumMaterialGrams(breakdown: { grams: number }[] | null): number | null {
  if (!breakdown || breakdown.length === 0) return null
  return Math.round(breakdown.reduce((sum, m) => sum + m.grams, 0) * 10) / 10
}

// Texto branco sobre um badge de cor clara (ex.: filamento branco) fica
// ilegível -- escolhe preto ou branco pelo brilho relativo da cor de fundo
// (luminância percebida, fórmula padrão W3C) em vez de sempre branco.
function readableTextColor(hex: string): string {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) return '#ffffff'
  const [r, g, b] = match.slice(1).map((c) => parseInt(c, 16))
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0f172a' : '#ffffff'
}

// Mesma conta que o próprio Anycubic Slicer faz pra mostrar "Término
// estimado" na tela de detalhes da tarefa -- agora + minutos restantes,
// sem precisar de nenhum dado novo do servidor.
function formatEta(remainingMinutes: number | null): string | null {
  if (remainingMinutes === null) return null
  const eta = new Date(Date.now() + remainingMinutes * 60_000)
  return eta.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
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
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null)
  const imageDialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const interval = setInterval(async () => {
      setPrinters(await getAllLiveStatuses())
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  function openImage(url: string) {
    setEnlargedImage(url)
    imageDialogRef.current?.showModal()
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {printers.map((printer) => (
        <div key={printer.printerId} className="tk-panel flex gap-3 p-4">
          {printer.thumbnailUrl && (
            <button
              type="button"
              onClick={() => openImage(printer.thumbnailUrl!)}
              className="shrink-0 cursor-zoom-in"
              aria-label="Ampliar imagem do modelo"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={printer.thumbnailUrl}
                alt="Modelo em impressão"
                className="h-28 w-28 rounded-lg object-cover"
              />
            </button>
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
              <div className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <div>
                  <div className="flex items-baseline justify-between">
                    <span>{ANYCUBIC_STATE_LABELS[printer.status.printState] ?? printer.status.printState}</span>
                    {printer.status.progressPercent !== null && (
                      <span className="font-display font-semibold text-violet-600 dark:text-violet-400">{printer.status.progressPercent}%</span>
                    )}
                  </div>
                  {printer.status.progressPercent !== null && (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500"
                        style={{ width: `${printer.status.progressPercent}%` }}
                      />
                    </div>
                  )}
                </div>

                {printer.status.gcodeFile && <p className="truncate text-slate-500 dark:text-slate-400">{printer.status.gcodeFile}</p>}

                {printer.status.printErrorMessage && (
                  <p className="text-red-600 dark:text-red-400">Erro: {printer.status.printErrorMessage}</p>
                )}

                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {printer.status.currentLayer !== null && printer.status.totalLayers !== null && (
                    <p>
                      Camada {printer.status.currentLayer}/{printer.status.totalLayers}
                    </p>
                  )}
                  {printer.status.printTimeMinutes !== null && <p>{printer.status.printTimeMinutes} min decorridos</p>}
                  {printer.status.remainingMinutes !== null && <p>{printer.status.remainingMinutes} min restantes</p>}
                  {formatEta(printer.status.remainingMinutes) && <p>Término estimado: {formatEta(printer.status.remainingMinutes)}</p>}
                </div>

                <details className="pt-1">
                  <summary className="tk-summary cursor-pointer text-xs">Informações do arquivo</summary>
                  <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {printer.modelDimensions && <p>Dimensões: {printer.modelDimensions}</p>}
                    {sumMaterialGrams(printer.materialBreakdown) !== null && (
                      <p>Consumo estimado: {sumMaterialGrams(printer.materialBreakdown)}g</p>
                    )}
                    {printer.materialBreakdown && printer.materialBreakdown.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {printer.materialBreakdown.map((material, i) => {
                          const bg = material.colorHex ?? '#64748b'
                          return (
                            <span
                              key={i}
                              className="rounded border border-slate-300 px-1.5 py-0.5 font-medium dark:border-slate-600"
                              style={{ backgroundColor: bg, color: readableTextColor(bg) }}
                            >
                              {material.materialType} {material.grams}g
                            </span>
                          )
                        })}
                      </div>
                    )}
                    {!printer.modelDimensions && sumMaterialGrams(printer.materialBreakdown) === null && (
                      <p className="italic">Sem dados de arquivo disponíveis ainda</p>
                    )}
                  </div>
                </details>

                <details className="pt-1">
                  <summary className="tk-summary cursor-pointer text-xs">Parâmetros</summary>
                  <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formatTemp(printer.status.nozzleTemp, printer.status.nozzleTargetTemp) && (
                      <p>Bico: {formatTemp(printer.status.nozzleTemp, printer.status.nozzleTargetTemp)}</p>
                    )}
                    {formatTemp(printer.status.bedTemp, printer.status.bedTargetTemp) && (
                      <p>Mesa: {formatTemp(printer.status.bedTemp, printer.status.bedTargetTemp)}</p>
                    )}
                    {printer.status.fanSpeedPercent !== null && <p>Ventoinha: {printer.status.fanSpeedPercent}%</p>}
                    {printer.status.printSpeedPercent !== null && <p>Velocidade: {printer.status.printSpeedPercent}%</p>}
                    {printer.status.printSpeedMode !== null && (
                      <p>Modo de velocidade: {printer.printSpeedModeLabels?.[printer.status.printSpeedMode] ?? printer.status.printSpeedMode}</p>
                    )}
                    {printer.status.firmwareVersion && <p>Firmware: {printer.status.firmwareVersion}</p>}
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      ))}

      <dialog
        ref={imageDialogRef}
        onClose={() => setEnlargedImage(null)}
        className="max-w-2xl rounded-xl border border-slate-200 bg-white p-2 backdrop:bg-slate-950/70 dark:border-slate-800 dark:bg-slate-900"
      >
        {enlargedImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={enlargedImage} alt="Modelo em impressão (ampliado)" className="max-h-[80vh] w-full rounded-lg object-contain" />
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
