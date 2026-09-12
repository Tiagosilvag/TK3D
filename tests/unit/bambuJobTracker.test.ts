import { describe, it, expect } from 'vitest'
import { createJobTracker } from '@/lib/bambu/jobTracker'
import type { BambuStatus } from '@/lib/bambu/parser'

function status(overrides: Partial<BambuStatus>): BambuStatus {
  return {
    gcodeState: 'IDLE',
    percent: null,
    remainingMinutes: null,
    layerNum: null,
    totalLayerNum: null,
    gcodeFile: null,
    nozzleTemp: null,
    bedTemp: null,
    amsTrays: [],
    chamberTemp: null,
    nozzleTargetTemp: null,
    bedTargetTemp: null,
    speedLevel: null,
    fanSpeeds: { heatbreak: null, cooling: null, big1: null, big2: null },
    wifiSignal: null,
    gcodeFilePreparePercent: null,
    nozzleDiameter: null,
    nozzleType: null,
    hmsCodes: [],
    printErrorCode: null,
    firmwareVersion: null,
    upgradeState: null,
    ...overrides,
  }
}

// Confirmação de fim de job exige 2 leituras terminais consecutivas com o
// mesmo estado (debounce, spec §5/§8) -- o segundo tick simula o próximo
// report da impressora, alguns segundos depois na vida real.
describe('createJobTracker', () => {
  it('não gera captura enquanto o job está rodando', () => {
    const tracker = createJobTracker()
    const t0 = new Date('2026-09-11T10:00:00Z')
    expect(tracker.handleStatus(status({ gcodeState: 'IDLE' }), t0)).toBeNull()
    expect(tracker.handleStatus(status({ gcodeState: 'RUNNING', gcodeFile: 'a.3mf' }), t0)).toBeNull()
  })

  it('gera captura FINISHED com duração e filamento pela diferença do spool, só após 2 leituras terminais seguidas', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    const firstFinish = new Date('2026-09-11T11:30:00Z')
    const secondFinish = new Date('2026-09-11T11:30:02Z')
    tracker.handleStatus(
      status({ gcodeState: 'RUNNING', gcodeFile: 'a.3mf', amsTrays: [{ id: '0', type: 'PLA', color: 'FFF', remainPercent: 80, tagUid: null }] }),
      start,
    )
    const pending = tracker.handleStatus(
      status({ gcodeState: 'FINISH', amsTrays: [{ id: '0', type: 'PLA', color: 'FFF', remainPercent: 75, tagUid: null }] }),
      firstFinish,
    )
    expect(pending).toBeNull()
    const capture = tracker.handleStatus(
      status({ gcodeState: 'FINISH', amsTrays: [{ id: '0', type: 'PLA', color: 'FFF', remainPercent: 75, tagUid: null }] }),
      secondFinish,
    )
    expect(capture).not.toBeNull()
    expect(capture!.outcome).toBe('FINISHED')
    // Duração conta até a PRIMEIRA leitura terminal, não a segunda (a
    // impressora já tinha terminado nesse instante -- o segundo tick é só
    // confirmação de ruído, não faz o job "durar mais").
    expect(capture!.durationHours).toBeCloseTo(1.5, 5)
    expect(capture!.gcodeFileName).toBe('a.3mf')
    // Sem peso total do rolo conhecido nesta versão, delta de % vira null
    // (limite documentado na spec) -- não inventa peso.
    expect(capture!.gramsUsedTotal).toBeNull()
    expect(capture!.amsBreakdown).toBeDefined()
  })

  it('gera captura FAILED quando o job termina em falha (2 leituras seguidas)', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    const end = new Date('2026-09-11T10:20:00Z')
    tracker.handleStatus(status({ gcodeState: 'RUNNING', gcodeFile: 'b.3mf' }), start)
    tracker.handleStatus(status({ gcodeState: 'FAILED' }), end)
    const capture = tracker.handleStatus(status({ gcodeState: 'FAILED' }), new Date(end.getTime() + 2000))
    expect(capture!.outcome).toBe('FAILED')
    expect(capture!.durationHours).toBeCloseTo(1 / 3, 5)
  })

  it('captura o código HMS quando o job falha, e nunca quando termina com sucesso', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    tracker.handleStatus(status({ gcodeState: 'RUNNING' }), start)
    tracker.handleStatus(status({ gcodeState: 'FAILED', hmsCodes: ['0300120000020001'] }), new Date(start.getTime() + 1000))
    const capture = tracker.handleStatus(status({ gcodeState: 'FAILED', hmsCodes: ['0300120000020001'] }), new Date(start.getTime() + 2000))
    expect(capture!.hmsCode).toBe('0300120000020001')

    const tracker2 = createJobTracker()
    tracker2.handleStatus(status({ gcodeState: 'RUNNING' }), start)
    tracker2.handleStatus(status({ gcodeState: 'FINISH' }), new Date(start.getTime() + 1000))
    const success = tracker2.handleStatus(status({ gcodeState: 'FINISH' }), new Date(start.getTime() + 2000))
    expect(success!.hmsCode).toBeNull()
  })

  it('usa printErrorCode como fallback quando não há hmsCodes na falha', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    tracker.handleStatus(status({ gcodeState: 'RUNNING' }), start)
    tracker.handleStatus(status({ gcodeState: 'FAILED', printErrorCode: '0500c010' }), new Date(start.getTime() + 1000))
    const capture = tracker.handleStatus(status({ gcodeState: 'FAILED', printErrorCode: '0500c010' }), new Date(start.getTime() + 2000))
    expect(capture!.hmsCode).toBe('0500c010')
  })

  it('não gera captura se nunca viu o job em RUNNING (restart no meio do job)', () => {
    const tracker = createJobTracker()
    tracker.handleStatus(status({ gcodeState: 'FINISH' }), new Date())
    const capture = tracker.handleStatus(status({ gcodeState: 'FINISH' }), new Date())
    expect(capture).toBeNull()
  })

  it('ruído/flapping: uma única leitura terminal isolada, seguida de volta pra RUNNING, não fecha o job', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    tracker.handleStatus(status({ gcodeState: 'RUNNING', gcodeFile: 'c.3mf' }), start)
    const pending = tracker.handleStatus(status({ gcodeState: 'IDLE' }), new Date(start.getTime() + 1000))
    expect(pending).toBeNull()
    // Volta a RUNNING antes da segunda confirmação -- job continua o mesmo,
    // sem gerar captura fantasma.
    const backToRunning = tracker.handleStatus(status({ gcodeState: 'RUNNING', gcodeFile: 'c.3mf' }), new Date(start.getTime() + 2000))
    expect(backToRunning).toBeNull()
    const stillRunningLater = tracker.handleStatus(status({ gcodeState: 'FINISH' }), new Date(start.getTime() + 5000))
    expect(stillRunningLater).toBeNull() // primeira leitura terminal real, ainda pendente de confirmação
  })

  it('duas leituras terminais seguidas mas com estados DIFERENTES não confirmam (exige o mesmo estado 2x)', () => {
    const tracker = createJobTracker()
    const start = new Date('2026-09-11T10:00:00Z')
    tracker.handleStatus(status({ gcodeState: 'RUNNING' }), start)
    tracker.handleStatus(status({ gcodeState: 'IDLE' }), new Date(start.getTime() + 1000))
    const capture = tracker.handleStatus(status({ gcodeState: 'FAILED' }), new Date(start.getTime() + 2000))
    expect(capture).toBeNull() // reinicia a contagem de confirmação com o novo estado terminal
  })
})
