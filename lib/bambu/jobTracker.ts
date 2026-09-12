import type { BambuAmsTray, BambuStatus } from './parser'

export type CaptureOutcome = 'FINISHED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN'

export type CaptureDraft = {
  startedAt: Date
  finishedAt: Date
  durationHours: number
  gcodeFileName: string | null
  gramsUsedTotal: number | null
  amsBreakdown: unknown
  outcome: CaptureOutcome
  // Código HMS bruto (hex) ou print_error quando o job termina em falha --
  // null pra sucesso/cancelamento. Sem tradução própria (ver listener.ts).
  hmsCode: string | null
}

type RunningJob = {
  startedAt: Date
  gcodeFile: string | null
  startTrays: BambuAmsTray[]
}

type PendingTermination = {
  gcodeState: string
  firstSeenAt: Date
  endTrays: BambuAmsTray[]
}

function mapOutcome(gcodeState: string): CaptureOutcome {
  if (gcodeState === 'FINISH') return 'FINISHED'
  if (gcodeState === 'FAILED') return 'FAILED'
  if (gcodeState === 'CANCELLED' || gcodeState === 'CANCELED') return 'CANCELLED'
  return 'UNKNOWN'
}

// Delta de filamento pelo % restante do spool antes/depois -- só confiável
// se soubermos o peso TOTAL do rolo, o que esta versão ainda não rastreia
// por bandeja (fica null nesse caso, nunca inventado -- ver spec §5/§8).
function computeGramsUsedTotal(_startTrays: BambuAmsTray[], _endTrays: BambuAmsTray[]): number | null {
  return null
}

const RUNNING_STATES = new Set(['RUNNING'])
const TERMINAL_STATES = new Set(['FINISH', 'FAILED', 'CANCELLED', 'CANCELED', 'IDLE'])

// Debounce (spec §5/§8): uma leitura terminal isolada não fecha o job --
// só confirma quando o MESMO estado terminal aparece 2 vezes seguidas
// (a impressora reporta a cada poucos segundos, então isso custa no
// máximo um tick de atraso na captura real, e blinda contra ruído). Se o
// job voltar a RUNNING antes da confirmação, ou o estado terminal mudar
// no meio, a contagem reinicia sem gerar captura nenhuma.
export function createJobTracker() {
  let current: RunningJob | null = null
  let pending: PendingTermination | null = null

  function handleStatus(status: BambuStatus, now: Date): CaptureDraft | null {
    const isRunning = RUNNING_STATES.has(status.gcodeState)

    if (isRunning) {
      pending = null
      if (!current) current = { startedAt: now, gcodeFile: status.gcodeFile, startTrays: status.amsTrays }
      return null
    }

    if (!current) {
      pending = null
      return null
    }

    if (!TERMINAL_STATES.has(status.gcodeState)) return null

    if (!pending || pending.gcodeState !== status.gcodeState) {
      pending = { gcodeState: status.gcodeState, firstSeenAt: now, endTrays: status.amsTrays }
      return null
    }

    // Segunda leitura consecutiva com o mesmo estado terminal -- confirma o
    // fim do job. Duração conta até a PRIMEIRA leitura terminal (quando a
    // impressora realmente parou), não até esta confirmação.
    const job = current
    const finishedAt = pending.firstSeenAt
    current = null
    pending = null

    const durationHours = (finishedAt.getTime() - job.startedAt.getTime()) / 3_600_000
    const outcome = mapOutcome(status.gcodeState)
    return {
      startedAt: job.startedAt,
      finishedAt,
      durationHours,
      gcodeFileName: job.gcodeFile,
      gramsUsedTotal: computeGramsUsedTotal(job.startTrays, status.amsTrays),
      amsBreakdown: { start: job.startTrays, end: status.amsTrays },
      outcome,
      hmsCode: outcome === 'FAILED' ? (status.hmsCodes[0] ?? status.printErrorCode) : null,
    }
  }

  return { handleStatus }
}
