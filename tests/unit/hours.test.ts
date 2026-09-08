import { describe, it, expect } from 'vitest'
import { decimalHoursToHHMM, hhmmToDecimalHours } from '@/lib/hours'

describe('decimalHoursToHHMM', () => {
  it('converte horas decimais pra HH:MM', () => {
    expect(decimalHoursToHHMM(1.5)).toBe('01:30')
    expect(decimalHoursToHHMM(0)).toBe('00:00')
    expect(decimalHoursToHHMM(2)).toBe('02:00')
    expect(decimalHoursToHHMM(0.25)).toBe('00:15')
  })

  it('arredonda pro minuto mais próximo', () => {
    expect(decimalHoursToHHMM(1.001)).toBe('01:00')
  })

  it('trata valores negativos ou inválidos como zero', () => {
    expect(decimalHoursToHHMM(-1)).toBe('00:00')
    expect(decimalHoursToHHMM(NaN)).toBe('00:00')
  })
})

describe('hhmmToDecimalHours', () => {
  it('converte HH:MM pra horas decimais', () => {
    expect(hhmmToDecimalHours('01:30')).toBeCloseTo(1.5, 5)
    expect(hhmmToDecimalHours('00:00')).toBe(0)
    expect(hhmmToDecimalHours('02:00')).toBe(2)
    expect(hhmmToDecimalHours('00:15')).toBeCloseTo(0.25, 5)
  })

  it('aceita horas sem zero à esquerda', () => {
    expect(hhmmToDecimalHours('1:30')).toBeCloseTo(1.5, 5)
  })

  it('retorna zero pra texto inválido', () => {
    expect(hhmmToDecimalHours('')).toBe(0)
    expect(hhmmToDecimalHours('abc')).toBe(0)
    expect(hhmmToDecimalHours('01:99')).toBe(0)
  })

  it('é a inversa de decimalHoursToHHMM pros mesmos valores', () => {
    for (const h of [0, 0.25, 0.5, 1, 1.5, 2.75, 10]) {
      expect(hhmmToDecimalHours(decimalHoursToHHMM(h))).toBeCloseTo(h, 5)
    }
  })
})
