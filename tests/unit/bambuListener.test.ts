import { describe, it, expect, vi } from 'vitest'
import { createListenerCore } from '@/lib/bambu/listener'

describe('createListenerCore', () => {
  it('só assina impressoras com bambuEnabled=true e bambuSerial preenchido', () => {
    const subscribe = vi.fn()
    const core = createListenerCore({
      printers: [
        { id: 'p1', bambuEnabled: true, bambuSerial: 'SER1' },
        { id: 'p2', bambuEnabled: false, bambuSerial: 'SER2' },
        { id: 'p3', bambuEnabled: true, bambuSerial: null },
      ],
      subscribe,
      onCapture: vi.fn(),
    })
    core.start()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith('SER1', expect.any(Function))
  })

  it('atualiza o cache em memória a cada mensagem e expõe via getLiveStatus', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const core = createListenerCore({
      printers: [{ id: 'p1', bambuEnabled: true, bambuSerial: 'SER1' }],
      subscribe: (serial, handler) => {
        handlers[serial] = handler
      },
      onCapture: vi.fn(),
    })
    core.start()
    handlers['SER1']({ print: { gcode_state: 'RUNNING', mc_percent: 10 } })
    expect(core.getLiveStatus('p1')?.gcodeState).toBe('RUNNING')
    expect(core.getLiveStatus('p1')?.percent).toBe(10)
  })

  it('chama onCapture quando um job termina, com o printerId certo (jobTracker exige 2 leituras terminais seguidas, ver Task 4)', () => {
    const handlers: Record<string, (payload: unknown) => void> = {}
    const onCapture = vi.fn()
    const core = createListenerCore({
      printers: [{ id: 'p1', bambuEnabled: true, bambuSerial: 'SER1' }],
      subscribe: (serial, handler) => {
        handlers[serial] = handler
      },
      onCapture,
    })
    core.start()
    handlers['SER1']({ print: { gcode_state: 'RUNNING' } })
    handlers['SER1']({ print: { gcode_state: 'FINISH' } })
    expect(onCapture).not.toHaveBeenCalled()
    handlers['SER1']({ print: { gcode_state: 'FINISH' } })
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCapture).toHaveBeenCalledWith('p1', expect.objectContaining({ outcome: 'FINISHED' }))
  })

  it('getLiveStatus devolve null pra impressora sem mensagem recebida ainda', () => {
    const core = createListenerCore({ printers: [{ id: 'p1', bambuEnabled: true, bambuSerial: 'SER1' }], subscribe: vi.fn(), onCapture: vi.fn() })
    core.start()
    expect(core.getLiveStatus('p1')).toBeNull()
  })
})
