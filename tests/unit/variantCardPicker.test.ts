import { describe, it, expect } from 'vitest'
import { matchesFilter } from '@/app/(app)/orders/VariantCardPicker'
import type { VariantAttr } from '@/lib/reports'

function attr(name: string, colorNames: string[]): VariantAttr {
  return {
    name,
    value: colorNames.join(' + '),
    tier: 'produto',
    colorHexes: [],
    shortValue: colorNames.join(' + '),
    material: null,
    colors: colorNames.map((n) => ({ hex: null, name: n })),
  }
}

describe('matchesFilter', () => {
  const attrs: VariantAttr[] = [
    attr('ANEL', ['Vermelho']),
    attr('BASE', ['Vermelho', 'Preto']),
    attr('CHAVEIRO', ['Vermelho', 'Preto']),
  ]

  it('sem filtro nenhum: sempre true', () => {
    expect(matchesFilter(attrs, '', '')).toBe(true)
  })

  it('só peça, peça existe na variante: true', () => {
    expect(matchesFilter(attrs, 'BASE', '')).toBe(true)
  })

  it('só peça, peça não existe na variante: false', () => {
    expect(matchesFilter(attrs, 'TOPO', '')).toBe(false)
  })

  it('só cor, cor existe em QUALQUER peça: true', () => {
    expect(matchesFilter(attrs, '', 'Preto')).toBe(true)
  })

  it('só cor, cor não existe em nenhuma peça: false', () => {
    expect(matchesFilter(attrs, '', 'Dourado')).toBe(false)
  })

  it('peça + cor combinados: true quando a cor está NAQUELA peça', () => {
    expect(matchesFilter(attrs, 'BASE', 'Preto')).toBe(true)
  })

  it('bug corrigido: peça + cor combinados, cor existe só em OUTRA peça -- false', () => {
    // ANEL só tem Vermelho -- Preto existe em BASE/CHAVEIRO, não em ANEL.
    expect(matchesFilter(attrs, 'ANEL', 'Preto')).toBe(false)
  })
})
