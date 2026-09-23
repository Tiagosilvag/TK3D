import { describe, it, expect, afterEach, vi } from 'vitest'
import { todayInBrasiliaString, todayInBrasilia } from '@/lib/timezone'

// Bug "app mostra a data errada perto da virada do dia" (relato do
// usuário: servidor com relógio certo em America/Sao_Paulo, mas o
// container roda em UTC -- um `new Date().toISOString().slice(0, 10)`
// cru já mostrava o dia seguinte entre ~21h e meia-noite de Brasília).
// Estes testes fixam "agora" num instante UTC que já virou o dia mas
// ainda é o dia anterior em Brasília (UTC-3) -- exatamente o cenário do
// print do usuário: 2026-09-23T00:31:00Z = 2026-09-22 21:31 -03.
describe('todayInBrasiliaString', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ainda mostra o dia anterior logo depois da meia-noite UTC, se em Brasília ainda não virou o dia', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T00:31:00.000Z'))
    expect(todayInBrasiliaString()).toBe('2026-09-22')
  })

  it('já mostra o dia seguinte só depois da meia-noite de Brasília (03:00 UTC)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T03:00:00.000Z'))
    expect(todayInBrasiliaString()).toBe('2026-09-23')
  })

  it('no meio do dia (sem risco de virada), bate com a data UTC também', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T15:00:00.000Z'))
    expect(todayInBrasiliaString()).toBe('2026-09-22')
  })
})

describe('todayInBrasilia', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('devolve meia-noite UTC do dia de Brasília, mesma convenção de campo DateTime data-only do app', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T00:31:00.000Z'))
    const result = todayInBrasilia()
    expect(result.toISOString()).toBe('2026-09-22T00:00:00.000Z')
  })
})
