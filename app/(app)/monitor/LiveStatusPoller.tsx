'use client'
import { useEffect, useState } from 'react'
import { getAllLiveBambuStatuses } from '@/actions/bambuStatus'

type LiveStatuses = Awaited<ReturnType<typeof getAllLiveBambuStatuses>>

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
