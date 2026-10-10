import { describe, expect, it } from 'vitest'
import { failedFor, clampInt, suggestWaste, plannedChangePatch, successChangePatch, failedChangePatch } from '@/lib/productionRunRow'

function row(overrides: Partial<{ quantityPlanned: string; quantitySuccess: string; filaments: { filamentId: string; weightGramsPerUnit: string; gramsWasted: string }[] }> = {}) {
  return {
    quantityPlanned: '10',
    quantitySuccess: '10',
    filaments: [{ filamentId: 'f1', weightGramsPerUnit: '5', gramsWasted: '0' }],
    ...overrides,
  }
}

describe('failedFor', () => {
  it('planejada - sucesso, nunca negativo', () => {
    expect(failedFor(row({ quantityPlanned: '10', quantitySuccess: '7' }))).toBe(3)
    expect(failedFor(row({ quantityPlanned: '10', quantitySuccess: '10' }))).toBe(0)
    expect(failedFor(row({ quantityPlanned: '5', quantitySuccess: '8' }))).toBe(0)
  })
})

describe('clampInt', () => {
  it('limita entre min e max', () => {
    expect(clampInt(5, 0, 10)).toBe(5)
    expect(clampInt(-5, 0, 10)).toBe(0)
    expect(clampInt(50, 0, 10)).toBe(10)
  })
})

describe('suggestWaste', () => {
  it('sugere gramas desperdiçadas = falhas × peso por unidade, só pra peça de 1 filamento', () => {
    const r = row({ filaments: [{ filamentId: 'f1', weightGramsPerUnit: '4', gramsWasted: '0' }] })
    expect(suggestWaste(r, 3)).toEqual({ filaments: [{ filamentId: 'f1', weightGramsPerUnit: '4', gramsWasted: '12' }] })
  })

  it('não sugere nada pra peça multi-filamento (2+ componentes)', () => {
    const r = row({ filaments: [{ filamentId: 'f1', weightGramsPerUnit: '4', gramsWasted: '0' }, { filamentId: 'f2', weightGramsPerUnit: '2', gramsWasted: '0' }] })
    expect(suggestWaste(r, 3)).toEqual({})
  })
})

describe('plannedChangePatch', () => {
  it('reduz planejada mantendo falhas (clampadas ao novo total) e recalcula sucesso', () => {
    const r = row({ quantityPlanned: '10', quantitySuccess: '7' }) // 3 falhas
    const patch = plannedChangePatch(r, '5')
    expect(patch.quantityPlanned).toBe('5')
    expect(patch.quantitySuccess).toBe('2') // 5 - min(3,5) = 2
  })

  it('nunca aceita planejada negativa', () => {
    const patch = plannedChangePatch(row(), '-3')
    expect(patch.quantityPlanned).toBe('0')
  })
})

describe('successChangePatch', () => {
  it('sucesso nunca passa do planejado', () => {
    const patch = successChangePatch(row({ quantityPlanned: '10' }), '15')
    expect(patch.quantitySuccess).toBe('10')
  })

  it('recalcula gramas desperdiçadas junto (peça de 1 filamento)', () => {
    const r = row({ quantityPlanned: '10', filaments: [{ filamentId: 'f1', weightGramsPerUnit: '2', gramsWasted: '0' }] })
    const patch = successChangePatch(r, '6') // 4 falhas
    expect(patch.quantitySuccess).toBe('6')
    expect(patch.filaments?.[0].gramsWasted).toBe('8')
  })
})

describe('failedChangePatch', () => {
  it('falhas nunca passa do planejado, sucesso = planejado - falhas', () => {
    const patch = failedChangePatch(row({ quantityPlanned: '10' }), '15')
    expect(patch.quantitySuccess).toBe('0') // falhas clampadas a 10, sucesso = 10-10
  })

  it('reduzir falhas pra 0 restaura sucesso = planejado', () => {
    const patch = failedChangePatch(row({ quantityPlanned: '10' }), '0')
    expect(patch.quantitySuccess).toBe('10')
  })
})
