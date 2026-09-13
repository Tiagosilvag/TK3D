import { describe, it, expect } from 'vitest'
import { parseAnycubicPayload, buildStatusPatch, applyStatusPatch, INITIAL_ANYCUBIC_STATUS } from '@/lib/anycubic/parser'

describe('anycubic parser', () => {
  it('parseAnycubicPayload aceita um payload válido com type/action/state/data', () => {
    const msg = parseAnycubicPayload({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 80 } })
    expect(msg).toEqual({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 80 } })
  })

  it('parseAnycubicPayload devolve null pra payload sem type/action', () => {
    expect(parseAnycubicPayload({ foo: 'bar' })).toBeNull()
    expect(parseAnycubicPayload(null)).toBeNull()
    expect(parseAnycubicPayload('string')).toBeNull()
  })

  it('buildStatusPatch extrai temperatura de uma mensagem type=tempature', () => {
    const patch = buildStatusPatch({
      type: 'tempature',
      action: 'auto',
      state: 'done',
      data: { curr_hotbed_temp: 58, curr_nozzle_temp: 210 },
    })
    expect(patch).toEqual({ bedTemp: 58, nozzleTemp: 210 })
  })

  it('buildStatusPatch extrai fan speed de uma mensagem type=fan', () => {
    const patch = buildStatusPatch({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 75 } })
    expect(patch).toEqual({ fanSpeedPercent: 75 })
  })

  it('buildStatusPatch mapeia início de impressão (type=print, action=start, state=printing) pro estado PRINTING com progresso/camada/arquivo', () => {
    const patch = buildStatusPatch({
      type: 'print',
      action: 'start',
      state: 'printing',
      data: { curr_layer: 12, total_layers: 200, filename: 'peca.gcode', progress: 6, remain_time: 118, print_time: 320 },
    })
    expect(patch).toEqual({
      printState: 'PRINTING',
      currentLayer: 12,
      totalLayers: 200,
      gcodeFile: 'peca.gcode',
      progressPercent: 6,
      remainingMinutes: 118,
      printTimeSeconds: 320,
    })
  })

  it('buildStatusPatch mapeia pausa (action=pause, state=paused) pro estado PAUSED', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'pause', state: 'paused', data: {} })
    expect(patch.printState).toBe('PAUSED')
  })

  it('buildStatusPatch mapeia fim com sucesso (action=start, state=finished) pro estado FINISHED', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'start', state: 'finished', data: { supplies_usage: 24 } })
    expect(patch.printState).toBe('FINISHED')
    expect(patch.suppliesUsage).toBe(24)
  })

  it('buildStatusPatch mapeia cancelamento (action=stop, state=stoped) pro estado CANCELLED', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'stop', state: 'stoped', data: {} })
    expect(patch.printState).toBe('CANCELLED')
  })

  it('buildStatusPatch mapeia falha (action=start, state=failed) pro estado CANCELLED (Anycubic não distingue falha de cancelamento neste stream)', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'start', state: 'failed', data: {} })
    expect(patch.printState).toBe('CANCELLED')
  })

  it('buildStatusPatch devolve objeto vazio pra tipo de mensagem não tratado (ex.: multiColorBox)', () => {
    expect(buildStatusPatch({ type: 'multiColorBox', action: 'x', state: 'y', data: {} })).toEqual({})
  })

  it('buildStatusPatch extrai temperatura atual de dentro de uma mensagem type=print também (não só type=tempature)', () => {
    const patch = buildStatusPatch({
      type: 'print',
      action: 'start',
      state: 'printing',
      data: { curr_hotbed_temp: 60, curr_nozzle_temp: 215 },
    })
    expect(patch.bedTemp).toBe(60)
    expect(patch.nozzleTemp).toBe(215)
  })

  it('buildStatusPatch extrai temperatura alvo/velocidade de dentro de data.settings (mensagem action=start|update, state=updated)', () => {
    const patch = buildStatusPatch({
      type: 'print',
      action: 'update',
      state: 'updated',
      data: {
        curr_hotbed_temp: 59,
        curr_nozzle_temp: 212,
        settings: { fan_speed_pct: 88, print_speed_pct: 120, print_speed_mode: 2, target_hotbed_temp: 60, target_nozzle_temp: 215 },
      },
    })
    expect(patch).toEqual({
      bedTemp: 59,
      nozzleTemp: 212,
      fanSpeedPercent: 88,
      printSpeedPercent: 120,
      printSpeedMode: 2,
      bedTargetTemp: 60,
      nozzleTargetTemp: 215,
    })
    // 'updated' é só notificação de ajuste de configuração -- não é
    // transição de estado de impressão, não deve mexer em printState.
    expect(patch.printState).toBeUndefined()
  })

  it('buildStatusPatch não quebra quando data.settings está ausente numa mensagem type=print', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'start', state: 'printing', data: { progress: 10 } })
    expect(patch.fanSpeedPercent).toBeUndefined()
    expect(patch.progressPercent).toBe(10)
  })

  it('buildStatusPatch extrai a versão de firmware de uma mensagem type=ota (action=reportVersion, state=done)', () => {
    const patch = buildStatusPatch({
      type: 'ota',
      action: 'reportVersion',
      state: 'done',
      data: { firmware_version: '1.2.3.4', device_unionid: 'x' },
    })
    expect(patch.firmwareVersion).toBe('1.2.3.4')
  })

  it('buildStatusPatch ignora mensagem type=ota de outro action/state (ex.: update/start, sem firmware_version ainda)', () => {
    const patch = buildStatusPatch({ type: 'ota', action: 'update', state: 'start', data: {} })
    expect(patch.firmwareVersion).toBeUndefined()
  })

  it('buildStatusPatch extrai a mensagem de erro quando a impressão falha (msg no nível raiz do payload, não em data)', () => {
    const patch = buildStatusPatch({
      type: 'print',
      action: 'start',
      state: 'failed',
      data: {},
      msg: 'Filament runout',
    })
    expect(patch.printState).toBe('CANCELLED')
    expect(patch.printErrorMessage).toBe('Filament runout')
  })

  it('buildStatusPatch não seta printErrorMessage quando a impressão não falhou', () => {
    const patch = buildStatusPatch({ type: 'print', action: 'start', state: 'printing', data: {} })
    expect(patch.printErrorMessage).toBeUndefined()
  })

  it('applyStatusPatch mescla só os campos presentes no patch, preservando o resto', () => {
    const prev = { ...INITIAL_ANYCUBIC_STATUS, nozzleTemp: 200, bedTemp: 55 }
    const next = applyStatusPatch(prev, { fanSpeedPercent: 90 })
    expect(next.fanSpeedPercent).toBe(90)
    expect(next.nozzleTemp).toBe(200)
    expect(next.bedTemp).toBe(55)
  })
})
