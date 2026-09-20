import { describe, it, expect, vi } from 'vitest'
import { createAnycubicListenerCore } from '@/lib/anycubic/listener'

describe('createAnycubicListenerCore', () => {
  it('só assina impressoras com anycubicEnabled=true e anycubicPrinterKey preenchida', () => {
    const subscribe = vi.fn()
    const core = createAnycubicListenerCore({
      printers: [
        { id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' },
        { id: 'p2', anycubicEnabled: false, anycubicPrinterKey: 'KEY2' },
        { id: 'p3', anycubicEnabled: true, anycubicPrinterKey: null },
      ],
      subscribe,
      onCapture: vi.fn(),
    })
    core.start()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith('KEY1', expect.any(Function))
  })

  it('acumula patches parciais no cache em memória e expõe via getLiveStatus', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: (key, handler) => {
        handlers[key] = handler
      },
      onCapture: vi.fn(),
    })
    core.start()
    handlers['KEY1']({ type: 'tempature', action: 'auto', state: 'done', data: { curr_hotbed_temp: 55, curr_nozzle_temp: 200 } })
    handlers['KEY1']({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 80 } })

    const status = core.getLiveStatus('p1')
    expect(status?.bedTemp).toBe(55)
    expect(status?.nozzleTemp).toBe(200)
    expect(status?.fanSpeedPercent).toBe(80)
  })

  it('getLiveStatus devolve null pra impressora sem mensagem recebida ainda', () => {
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: vi.fn(),
      onCapture: vi.fn(),
    })
    core.start()
    expect(core.getLiveStatus('p1')).toBeNull()
  })

  it('chama onCapture quando um job termina, com o printerId certo (debounce de 2 leituras, ver Task 6)', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const onCapture = vi.fn()
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: (key, handler) => {
        handlers[key] = handler
      },
      onCapture,
    })
    core.start()
    handlers['KEY1']({ type: 'print', action: 'start', state: 'printing', data: { filename: 'a.gcode' } })
    handlers['KEY1']({ type: 'print', action: 'start', state: 'finished', data: {} })
    expect(onCapture).not.toHaveBeenCalled()
    handlers['KEY1']({ type: 'print', action: 'start', state: 'finished', data: {} })
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCapture).toHaveBeenCalledWith('p1', expect.objectContaining({ outcome: 'FINISHED' }))
  })

  it('chama onJobStart uma vez quando o taskid muda (job novo)', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const onJobStart = vi.fn()
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: (key, handler) => {
        handlers[key] = handler
      },
      onCapture: vi.fn(),
      onJobStart,
    })
    core.start()
    handlers['KEY1']({ type: 'print', action: 'start', state: 'printing', data: { taskid: 111 } })
    expect(onJobStart).toHaveBeenCalledTimes(1)
    expect(onJobStart).toHaveBeenCalledWith('p1', 111)
    // Mesmo taskid em ticks seguintes -- não dispara de novo
    handlers['KEY1']({ type: 'print', action: 'start', state: 'printing', data: { taskid: 111 } })
    expect(onJobStart).toHaveBeenCalledTimes(1)
    // Taskid novo -- dispara de novo
    handlers['KEY1']({ type: 'print', action: 'start', state: 'printing', data: { taskid: 222 } })
    expect(onJobStart).toHaveBeenCalledTimes(2)
    expect(onJobStart).toHaveBeenLastCalledWith('p1', 222)
  })

  it('não chama onJobStart quando a mensagem não traz taskid', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const onJobStart = vi.fn()
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: (key, handler) => {
        handlers[key] = handler
      },
      onCapture: vi.fn(),
      onJobStart,
    })
    core.start()
    handlers['KEY1']({ type: 'fan', action: 'auto', state: 'done', data: { fan_speed_pct: 50 } })
    expect(onJobStart).not.toHaveBeenCalled()
  })

  it('ingestProject (fallback HTTP) atualiza status, taskid e dispara onJobStart uma vez', () => {
    const onJobStart = vi.fn()
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: vi.fn(),
      onCapture: vi.fn(),
      onJobStart,
    })
    core.start()
    core.ingestProject('p1', 555, { printState: 'PAUSED', progressPercent: 25, currentLayer: 48, totalLayers: 451 })
    core.ingestProject('p1', 555, { printState: 'PRINTING', progressPercent: 26 })

    expect(onJobStart).toHaveBeenCalledTimes(1)
    expect(onJobStart).toHaveBeenCalledWith('p1', 555)
    expect(core.getCurrentTaskId('p1')).toBe(555)
    const status = core.getLiveStatus('p1')
    expect(status?.printState).toBe('PRINTING')
    expect(status?.progressPercent).toBe(26)
    // campo que o segundo patch não trouxe continua do primeiro
    expect(status?.currentLayer).toBe(48)
  })

  it('ingestProject preserva o que o MQTT já preencheu (temperaturas)', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: (key, handler) => {
        handlers[key] = handler
      },
      onCapture: vi.fn(),
    })
    core.start()
    handlers['KEY1']({ type: 'tempature', action: 'auto', state: 'done', data: { curr_nozzle_temp: 210 } })
    core.ingestProject('p1', 1, { printState: 'PRINTING', progressPercent: 10 })
    expect(core.getLiveStatus('p1')?.nozzleTemp).toBe(210)
    expect(core.getLiveStatus('p1')?.progressPercent).toBe(10)
  })

  it('ingestProject ignora impressora que não está sendo monitorada', () => {
    const onJobStart = vi.fn()
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: vi.fn(),
      onCapture: vi.fn(),
      onJobStart,
    })
    core.start()
    core.ingestProject('desconhecida', 9, { printState: 'PRINTING' })
    expect(onJobStart).not.toHaveBeenCalled()
    expect(core.getLiveStatus('desconhecida')).toBeNull()
  })

  it('getCurrentTaskId expõe o taskid do job atual (ajuste "controle de impressão Anycubic": exigido pra pausar/retomar/parar)', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const core = createAnycubicListenerCore({
      printers: [{ id: 'p1', anycubicEnabled: true, anycubicPrinterKey: 'KEY1' }],
      subscribe: (key, handler) => {
        handlers[key] = handler
      },
      onCapture: vi.fn(),
    })
    core.start()
    expect(core.getCurrentTaskId('p1')).toBeNull()
    handlers['KEY1']({ type: 'print', action: 'start', state: 'printing', data: { taskid: 333 } })
    expect(core.getCurrentTaskId('p1')).toBe(333)
  })
})
