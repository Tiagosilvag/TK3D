import type { AnycubicStatus } from './parser'

export type AnycubicCaptureOutcome = 'FINISHED' | 'CANCELLED' | 'UNKNOWN'

export type AnycubicCaptureDraft = {
  startedAt: Date
  finishedAt: Date
  durationHours: number
  gcodeFileName: string | null
  gramsUsedTotal: number | null
  outcome: AnycubicCaptureOutcome
}

type RunningJob = { startedAt: Date; gcodeFile: string | null }
type PendingTermination = { printState: string; firstSeenAt: Date; suppliesUsage: number | null }

function mapOutcome(printState: string): AnycubicCaptureOutcome {
  if (printState === 'FINISHED') return 'FINISHED'
  if (printState === 'CANCELLED') return 'CANCELLED'
  return 'UNKNOWN'
}

const RUNNING_STATES = new Set(['PRINTING'])
// PAUSED não é terminal nem "em andamento" pro tracker -- volta a PRINTING
// ou vira terminal depois, mas por si só não fecha nem reinicia o job.
const TERMINAL_STATES = new Set(['FINISHED', 'CANCELLED', 'IDLE'])

// Mesmo debounce de 2 leituras terminais seguidas do lib/bambu/jobTracker.ts
// (duplicado de propósito, ver plano Task 6) -- protege contra ruído de
// rede/report sem inventar um mecanismo novo.
export function createAnycubicJobTracker() {
  let current: RunningJob | null = null
  let pending: PendingTermination | null = null

  function handleStatus(status: AnycubicStatus, now: Date): AnycubicCaptureDraft | null {
    const isRunning = RUNNING_STATES.has(status.printState)

    if (isRunning) {
      pending = null
      if (!current) current = { startedAt: now, gcodeFile: status.gcodeFile }
      return null
    }

    if (!current) {
      pending = null
      return null
    }

    if (!TERMINAL_STATES.has(status.printState)) return null

    if (!pending || pending.printState !== status.printState) {
      pending = { printState: status.printState, firstSeenAt: now, suppliesUsage: status.suppliesUsage }
      return null
    }

    const job = current
    const finishedAt = pending.firstSeenAt
    const suppliesUsage = pending.suppliesUsage
    current = null
    pending = null

    const durationHours = (finishedAt.getTime() - job.startedAt.getTime()) / 3_600_000

    return {
      startedAt: job.startedAt,
      finishedAt,
      durationHours,
      gcodeFileName: job.gcodeFile,
      gramsUsedTotal: suppliesUsage,
      outcome: mapOutcome(status.printState),
    }
  }

  return { handleStatus }
}
