import { describe, it, expect } from 'vitest'
import { buildPauseCommand, buildResumeCommand, buildStopCommand } from '@/lib/bambu/commands'

describe('bambu commands', () => {
  it('monta o comando de pausar', () => {
    expect(buildPauseCommand()).toEqual({ print: { command: 'pause' } })
  })

  it('monta o comando de retomar', () => {
    expect(buildResumeCommand()).toEqual({ print: { command: 'resume' } })
  })

  it('monta o comando de parar', () => {
    expect(buildStopCommand()).toEqual({ print: { command: 'stop' } })
  })
})
