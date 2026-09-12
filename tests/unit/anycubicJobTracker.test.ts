import { describe, it, expect } from 'vitest'
import { createAnycubicJobTracker } from '@/lib/anycubic/jobTracker'
import { INITIAL_ANYCUBIC_STATUS, type AnycubicStatus } from '@/lib/anycubic/parser'

function status(overrides: Partial<AnycubicStatus>): AnycubicStatus {
  return { ...INITIAL_ANYCUBIC_STATUS, ...overrides }
}

describe('createAnycubicJobTracker', () => {
  it('não gera captura enquanto só recebe leituras IDLE', () => {
    const tracker = createAnycubicJobTracker()
    expect(tracker.handleStatus(status({ printState: 'IDLE' }), new Date())).toBeNull()
  })

  it('inicia um job na primeira leitura PRINTING e não gera captura até terminar', () => {
    const tracker = createAnycubicJobTracker()
    const t0 = new Date('2026-09-12T10:00:00Z')
    expect(tracker.handleStatus(status({ printState: 'PRINTING', gcodeFile: 'peca.gcode' }), t0)).toBeNull()
    expect(tracker.handleStatus(status({ printState: 'PRINTING', gcodeFile: 'peca.gcode' }), new Date('2026-09-12T10:05:00Z'))).toBeNull()
  })

  it('exige 2 leituras terminais iguais seguidas antes de confirmar FINISHED', () => {
    const tracker = createAnycubicJobTracker()
    const t0 = new Date('2026-09-12T10:00:00Z')
    tracker.handleStatus(status({ printState: 'PRINTING', gcodeFile: 'peca.gcode' }), t0)

    const t1 = new Date('2026-09-12T11:00:00Z')
    expect(tracker.handleStatus(status({ printState: 'FINISHED' }), t1)).toBeNull()

    const t2 = new Date('2026-09-12T11:00:10Z')
    const capture = tracker.handleStatus(status({ printState: 'FINISHED' }), t2)
    expect(capture).not.toBeNull()
    expect(capture?.outcome).toBe('FINISHED')
    expect(capture?.startedAt).toEqual(t0)
    expect(capture?.finishedAt).toEqual(t1)
    expect(capture?.durationHours).toBeCloseTo(1, 5)
    expect(capture?.gcodeFileName).toBe('peca.gcode')
  })

  it('reinicia a contagem se o estado terminal mudar no meio (ex.: FINISHED depois CANCELLED)', () => {
    const tracker = createAnycubicJobTracker()
    tracker.handleStatus(status({ printState: 'PRINTING' }), new Date('2026-09-12T10:00:00Z'))
    expect(tracker.handleStatus(status({ printState: 'FINISHED' }), new Date('2026-09-12T11:00:00Z'))).toBeNull()
    expect(tracker.handleStatus(status({ printState: 'CANCELLED' }), new Date('2026-09-12T11:00:05Z'))).toBeNull()
    const capture = tracker.handleStatus(status({ printState: 'CANCELLED' }), new Date('2026-09-12T11:00:10Z'))
    expect(capture?.outcome).toBe('CANCELLED')
  })

  it('mapeia CANCELLED pra outcome CANCELLED e usa supplies_usage como gramsUsedTotal quando presente', () => {
    const tracker = createAnycubicJobTracker()
    tracker.handleStatus(status({ printState: 'PRINTING' }), new Date('2026-09-12T10:00:00Z'))
    tracker.handleStatus(status({ printState: 'FINISHED', suppliesUsage: 18.5 }), new Date('2026-09-12T11:00:00Z'))
    const capture = tracker.handleStatus(status({ printState: 'FINISHED', suppliesUsage: 18.5 }), new Date('2026-09-12T11:00:10Z'))
    expect(capture?.gramsUsedTotal).toBe(18.5)
  })

  it('volta a PRINTING antes da confirmação cancela a pendência sem gerar captura', () => {
    const tracker = createAnycubicJobTracker()
    tracker.handleStatus(status({ printState: 'PRINTING' }), new Date('2026-09-12T10:00:00Z'))
    expect(tracker.handleStatus(status({ printState: 'PAUSED' }), new Date('2026-09-12T10:30:00Z'))).toBeNull()
    expect(tracker.handleStatus(status({ printState: 'PRINTING' }), new Date('2026-09-12T10:31:00Z'))).toBeNull()
  })
})
