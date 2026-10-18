import { describe, it, expect, afterEach, vi } from 'vitest'
import { todayInBrasiliaString, todayInBrasilia, brasiliaDayKey, utcDayKey } from '@/lib/timezone'

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

// Bug "venda/entrega no mesmo dia da montagem desaparece do rastreio"
// (lib/productUnitTrail.ts): ProductAssembly.assembledAt é um timestamp
// REAL (@default(now()), hora exata do clique) -- precisa de
// brasiliaDayKey (converte fuso) pra achar o dia-calendário certo.
// ConsignmentDelivery.deliveryDate/ConsignmentSaleReport.reportDate vêm de
// um <input type="date"> -- sempre meia-noite UTC -- precisam de
// utcDayKey (sem converter fuso nenhum, meia-noite UTC do dia 12 JÁ é o
// dia 12 por convenção). Comparar os dois tipos de campo pelo timestamp
// cru (ou pior, aplicar brasiliaDayKey nos dois) sempre ordenava errado.
describe('brasiliaDayKey', () => {
  it('distingue dias calendário diferentes em Brasília', () => {
    const day1 = new Date('2026-08-31T17:30:00.000Z')
    const day2 = new Date('2026-09-12T17:30:00.000Z')
    expect(brasiliaDayKey(day1)).toBeLessThan(brasiliaDayKey(day2))
  })

  it('uma hora de madrugada em UTC que ainda é o dia anterior em Brasília cai no dia de Brasília, não no dia UTC', () => {
    // 2026-09-12T01:00:00Z = 2026-09-11T22:00:00-03:00 -- ainda 11/09 em Brasília.
    const lateNightUtc = new Date('2026-09-12T01:00:00.000Z')
    const sameCalendarDayBrasilia = new Date('2026-09-11T15:00:00.000Z')
    expect(brasiliaDayKey(lateNightUtc)).toBe(brasiliaDayKey(sameCalendarDayBrasilia))
  })
})

describe('utcDayKey', () => {
  it('lê o dia direto em UTC, sem converter fuso nenhum', () => {
    const deliveryDateMidnightUtc = new Date('2026-09-12T00:00:00.000Z')
    expect(utcDayKey(deliveryDateMidnightUtc)).toBe(20260912)
  })

  it('o MESMO dia digitado num campo "só data" e uma montagem real naquele dia em Brasília caem no mesmo dia-chave', () => {
    // A pessoa digitou "12/09" na entrega (meia-noite UTC do dia 12) e
    // confirmou a montagem às 14:30 de Brasília do MESMO dia 12
    // (17:30 UTC) -- as duas devem valer o mesmo dia-chave (20260912),
    // senão a entrega volta a "sumir" uma unidade que nem existia ainda.
    const deliveryDateMidnightUtc = new Date('2026-09-12T00:00:00.000Z')
    const assembledAtRealTime = new Date('2026-09-12T17:30:00.000Z')
    expect(utcDayKey(deliveryDateMidnightUtc)).toBe(brasiliaDayKey(assembledAtRealTime))
  })
})
