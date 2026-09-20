import { describe, it, expect } from 'vitest'
import { parseLiveProject, statusPatchFromLiveProject, isInProgressStatus } from '@/lib/anycubic/liveProject'

const base = {
  id: 987,
  printer_id: 111,
  print_status: 1,
  pause: 0,
  progress: 25,
  remain_time: 494,
  print_time: 171,
  gcode_name: 'Meia direita.gcode.3mf',
  settings: { curr_layer: 48, total_layers: 451 },
}

describe('parseLiveProject', () => {
  it('lê os campos do registro de projeto (semântica da lib de referência)', () => {
    expect(parseLiveProject(base)).toEqual({
      id: 987,
      printerId: 111,
      printStatus: 1,
      paused: false,
      progressPercent: 25,
      remainingMinutes: 494,
      printTimeMinutes: 171,
      gcodeName: 'Meia direita.gcode.3mf',
      currentLayer: 48,
      totalLayers: 451,
    })
  })

  it('pause != 0 com print em andamento = pausada', () => {
    expect(parseLiveProject({ ...base, pause: 1 })?.paused).toBe(true)
  })

  it('pause != 0 mas print concluído NÃO conta como pausada', () => {
    expect(parseLiveProject({ ...base, pause: 1, print_status: 2 })?.paused).toBe(false)
  })

  it('aceita settings como string JSON e números como string', () => {
    const p = parseLiveProject({ ...base, progress: '40', settings: JSON.stringify({ curr_layer: '10', total_layers: 20 }) })
    expect(p?.progressPercent).toBe(40)
    expect(p?.currentLayer).toBe(10)
    expect(p?.totalLayers).toBe(20)
  })

  it('devolve null sem id ou com registro inválido, e campos ausentes viram null', () => {
    expect(parseLiveProject(null)).toBeNull()
    expect(parseLiveProject({ progress: 3 })).toBeNull()
    const p = parseLiveProject({ id: 5 })
    expect(p).toMatchObject({ id: 5, printStatus: null, progressPercent: null, currentLayer: null, gcodeName: null, paused: false })
  })
})

describe('statusPatchFromLiveProject', () => {
  it('mapeia print_status pros estados do card', () => {
    const state = (over: Record<string, unknown>) => statusPatchFromLiveProject(parseLiveProject({ ...base, ...over })!).printState
    expect(state({})).toBe('PRINTING')
    expect(state({ pause: 1 })).toBe('PAUSED')
    expect(state({ print_status: 2 })).toBe('FINISHED')
    expect(state({ print_status: 3 })).toBe('CANCELLED')
    expect(state({ print_status: 4 })).toBe('DOWNLOADING')
    expect(state({ print_status: 5 })).toBe('CHECKING')
    expect(state({ print_status: 6 })).toBe('PREHEATING')
    expect(state({ print_status: 99 })).toBeUndefined()
  })

  it('só inclui campos presentes (não apaga o que o MQTT preencheu)', () => {
    const patch = statusPatchFromLiveProject(parseLiveProject({ id: 1, print_status: 1 })!)
    expect(patch).toEqual({ printState: 'PRINTING' })
  })

  it('leva progresso, tempos, arquivo e camadas', () => {
    expect(statusPatchFromLiveProject(parseLiveProject(base)!)).toEqual({
      printState: 'PRINTING',
      progressPercent: 25,
      remainingMinutes: 494,
      printTimeMinutes: 171,
      gcodeFile: 'Meia direita.gcode.3mf',
      currentLayer: 48,
      totalLayers: 451,
    })
  })
})

describe('isInProgressStatus', () => {
  it('imprimindo/baixando/verificando/aquecendo estão em andamento; concluída/cancelada/nulo não', () => {
    expect([1, 4, 5, 6].every((s) => isInProgressStatus(s))).toBe(true)
    expect([2, 3, 7, null].some((s) => isInProgressStatus(s))).toBe(false)
  })
})
