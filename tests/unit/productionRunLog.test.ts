import { describe, it, expect } from 'vitest'
import { summarizeRunChange, type RunComparable } from '@/lib/productionRunLog'

const base: RunComparable = {
  date: '2026-10-20', printerId: 'p1', timeWastedHours: 0, wasteReason: null, notes: null,
  quantityPlanned: 3, quantitySuccess: 3, filaments: [{ filamentId: 'a', weightGramsPerUnit: 10, gramsWasted: 0 }],
}

describe('summarizeRunChange', () => {
  it('descreve quantidades, falhas e gramas', () => {
    const after = { ...base, quantitySuccess: 2, filaments: [{ filamentId: 'a', weightGramsPerUnit: 15, gramsWasted: 0 }] }
    expect(summarizeRunChange(base, after)).toBe('Sucesso 3 → 2 · Falhas 0 → 1 · Gramas 30 → 45 g')
  })
  it('descreve troca de rolo, cores, impressora e data', () => {
    expect(summarizeRunChange(base, { ...base, filaments: [{ filamentId: 'b', weightGramsPerUnit: 10, gramsWasted: 0 }] })).toBe('Filamento trocado')
    expect(summarizeRunChange(base, { ...base, filaments: [...base.filaments, { filamentId: 'b', weightGramsPerUnit: 0, gramsWasted: 0 }] })).toBe('Cores 1 → 2')
    expect(summarizeRunChange(base, { ...base, printerId: 'p2', date: '2026-10-21' })).toBe('Data 2026-10-20 → 2026-10-21 · Impressora trocada')
  })
  it('sem diferença', () => {
    expect(summarizeRunChange(base, { ...base })).toBe('Salvo sem mudanças')
  })
})
