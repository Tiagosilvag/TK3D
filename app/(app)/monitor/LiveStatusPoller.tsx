'use client'
import { useEffect, useRef, useState } from 'react'
import { getAllLiveStatuses } from '@/actions/bambuStatus'
import { pausePrintJob, resumePrintJob, stopPrintJob } from '@/actions/bambuControl'
import { pauseAnycubicPrintJob, resumeAnycubicPrintJob, stopAnycubicPrintJob } from '@/actions/anycubicControl'

type LiveStatuses = Awaited<ReturnType<typeof getAllLiveStatuses>>
type ControlResult = { success: boolean; error?: string }
type ControlFn = (printerId: string) => Promise<ControlResult>

const BAMBU_PAUSABLE_STATES = new Set(['RUNNING'])
const BAMBU_RESUMABLE_STATES = new Set(['PAUSE'])
const BAMBU_STOPPABLE_STATES = new Set(['RUNNING', 'PAUSE', 'PREPARE'])

// order_id 2/3/4 (ver lib/anycubic/auth.ts#ANYCUBIC_ORDER_ID) só faz sentido
// com um job em andamento -- mesmos estados "tem projeto ativo" usados pelo
// jobTracker (lib/anycubic/jobTracker.ts#RUNNING_STATES/TERMINAL_STATES).
const ANYCUBIC_PAUSABLE_STATES = new Set(['PRINTING'])
const ANYCUBIC_RESUMABLE_STATES = new Set(['PAUSED'])
const ANYCUBIC_STOPPABLE_STATES = new Set(['DOWNLOADING', 'CHECKING', 'PREHEATING', 'PRINTING', 'PAUSED'])

// Genérico o bastante pra servir Bambu (MQTT publish) e Anycubic (HTTP
// sendOrder) -- só o conjunto de estados e as funções de comando mudam por
// marca, o resto (botões, diálogo de confirmação, pending/error) é idêntico.
function PrintControls({
  printerId,
  printerName,
  state,
  pausableStates,
  resumableStates,
  stoppableStates,
  pause,
  resume,
  stop,
}: {
  printerId: string
  printerName: string
  state: string
  pausableStates: Set<string>
  resumableStates: Set<string>
  stoppableStates: Set<string>
  pause: ControlFn
  resume: ControlFn
  stop: ControlFn
}) {
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

  async function run(kind: 'pause' | 'resume' | 'stop', fn: ControlFn) {
    setPending(kind)
    setError(null)
    const result = await fn(printerId)
    setPending(null)
    if (!result.success) setError(result.error ?? 'Falha ao enviar comando')
    else dialogRef.current?.close()
  }

  const canPause = pausableStates.has(state)
  const canResume = resumableStates.has(state)
  const canStop = stoppableStates.has(state)

  if (!canPause && !canResume && !canStop && !dialogOpen) return null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {canPause && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => run('pause', pause)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {pending === 'pause' ? 'Pausando…' : 'Pausar'}
        </button>
      )}
      {canResume && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => run('resume', resume)}
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
        <div className="grid grid-cols-1 gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Parar impressão em &ldquo;{printerName}&rdquo;?</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Essa ação não pode ser desfeita — a peça em andamento será perdida.</p>
          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => run('stop', stop)}
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
  // URLs de thumbnail que falharam ao carregar (a URL da nuvem é assinada e
  // vence no meio da impressão) -- some com a imagem quebrada em vez de
  // mostrar o texto do alt; o servidor renova a URL e, sendo uma string
  // nova, ela volta a ser tentada no próximo poll.
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set())
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
          {printer.thumbnailUrl && !brokenThumbs.has(printer.thumbnailUrl) && (
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
                onError={() => setBrokenThumbs((prev) => new Set(prev).add(printer.thumbnailUrl!))}
              />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{printer.name}</h3>
            {!printer.connection.live && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {printer.connection.status === 'expired'
                  ? 'Conexão com a nuvem recusada — reconecte a conta em Impressoras. Os dados abaixo estão desatualizados.'
                  : 'Sem conexão com a nuvem no momento — os dados abaixo podem estar desatualizados.'}
              </p>
            )}
            {printer.brand === 'bambu' ? (
              !printer.status ? (
                <p className="mt-2 text-sm text-slate-400">Sem dados ainda</p>
              ) : (
                <div className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span>{STATE_LABELS[printer.status.gcodeState] ?? printer.status.gcodeState}</span>
                      {printer.status.percent !== null && (
                        <span className="font-display font-semibold text-violet-600 dark:text-violet-400">{printer.status.percent}%</span>
                      )}
                    </div>
                    {printer.status.percent !== null && (
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-600 to-blue-500"
                          style={{ width: `${printer.status.percent}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {printer.status.gcodeFilePreparePercent !== null && printer.status.gcodeFilePreparePercent < 100 && (
                    <p className="text-slate-500 dark:text-slate-400">Preparando arquivo: {printer.status.gcodeFilePreparePercent}%</p>
                  )}
                  {printer.status.gcodeFile && <p className="truncate text-slate-500 dark:text-slate-400">{printer.status.gcodeFile}</p>}

                  {printer.status.hmsCodes.length > 0 && (
                    <p className="text-red-600 dark:text-red-400">Alerta HMS: {printer.status.hmsCodes.join(', ')}</p>
                  )}
                  {/* A A1/P1 continua mandando o print_error do ÚLTIMO erro mesmo
                      imprimindo normal (só limpa no próximo erro/reinício) --
                      só é relevante com a impressora pausada/falha. Alertas HMS
                      acima se limpam sozinhos e seguem sempre visíveis. */}
                  {printer.status.printErrorCode && ['PAUSE', 'FAILED'].includes(printer.status.gcodeState) && (
                    <p className="text-red-600 dark:text-red-400">Erro: {printer.status.printErrorCode}</p>
                  )}

                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {printer.status.layerNum !== null && printer.status.totalLayerNum !== null && (
                      <p>
                        Camada {printer.status.layerNum}/{printer.status.totalLayerNum}
                      </p>
                    )}
                    {printer.status.remainingMinutes !== null && <p>{printer.status.remainingMinutes} min restantes</p>}
                    {formatEta(printer.status.remainingMinutes) && <p>Término estimado: {formatEta(printer.status.remainingMinutes)}</p>}
                  </div>

                  <PrintControls
                    printerId={printer.printerId}
                    printerName={printer.name}
                    state={printer.status.gcodeState}
                    pausableStates={BAMBU_PAUSABLE_STATES}
                    resumableStates={BAMBU_RESUMABLE_STATES}
                    stoppableStates={BAMBU_STOPPABLE_STATES}
                    pause={pausePrintJob}
                    resume={resumePrintJob}
                    stop={stopPrintJob}
                  />

                  <details className="pt-1">
                    <summary className="tk-summary cursor-pointer text-xs">Informações do arquivo</summary>
                    <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {printer.status.amsTrays.length > 0 ? (
                        printer.status.amsTrays.map((tray) => (
                          <p key={tray.id}>
                            Slot {tray.id}: {tray.type || '—'} · {tray.remainPercent}%{' '}
                            {tray.tagUid && tray.tagUid !== '0000000000000000' ? '(rolo Bambu)' : '(rolo genérico)'}
                          </p>
                        ))
                      ) : (
                        <p className="italic">Sem dados de AMS disponíveis ainda</p>
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
                        className="h-full rounded-full bg-gradient-to-r from-violet-600 to-blue-500"
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

                <PrintControls
                  printerId={printer.printerId}
                  printerName={printer.name}
                  state={printer.status.printState}
                  pausableStates={ANYCUBIC_PAUSABLE_STATES}
                  resumableStates={ANYCUBIC_RESUMABLE_STATES}
                  stoppableStates={ANYCUBIC_STOPPABLE_STATES}
                  pause={pauseAnycubicPrintJob}
                  resume={resumeAnycubicPrintJob}
                  stop={stopAnycubicPrintJob}
                />

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
