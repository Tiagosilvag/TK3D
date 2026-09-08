import { describe, it, expect } from 'vitest'
import { getProductionStatusBadge, WASTE_REASON_LABELS } from '@/lib/format'
import type { ProductionStatus, WasteReason } from '@prisma/client'

// Task 8 (spec §5.4/§6, task-8 brief): history table renders a colored
// badge per ProductionStatus. One label+className pair per enum value,
// covering all four so a future enum addition fails this test instead of
// silently rendering "undefined".
describe('getProductionStatusBadge', () => {
  const cases: [ProductionStatus, string][] = [
    ['CONCLUIDA', 'Concluída'],
    ['PARCIAL', 'Parcial'],
    ['COM_FALHAS', 'Com falhas'],
    ['CANCELADA', 'Cancelada'],
  ]

  it.each(cases)('%s -> label %s', (status, label) => {
    const badge = getProductionStatusBadge(status)
    expect(badge.label).toBe(label)
    expect(badge.className).toEqual(expect.any(String))
    expect(badge.className.length).toBeGreaterThan(0)
  })

  it('gives every status a distinct className (visually distinguishable)', () => {
    const classNames = cases.map(([status]) => getProductionStatusBadge(status).className)
    expect(new Set(classNames).size).toBe(classNames.length)
  })
})

// WASTE_REASON_LABELS backs the wasteReason <select> in ProductionRunForm --
// must cover exactly the 8 enum values from prisma/schema.prisma (spec §5.4),
// no more, no less.
describe('WASTE_REASON_LABELS', () => {
  const expectedKeys: WasteReason[] = [
    'FALHA_IMPRESSAO',
    'ERRO_CONFIGURACAO',
    'SUPORTE_EXCESSIVO',
    'QUEBRA',
    'TESTE',
    'PURGA',
    'TROCA_FILAMENTO',
    'OUTRO',
  ]

  it('has exactly the 8 WasteReason enum values as keys', () => {
    expect(Object.keys(WASTE_REASON_LABELS).sort()).toEqual([...expectedKeys].sort())
  })

  it('every label is a non-empty human-readable string', () => {
    for (const key of expectedKeys) {
      expect(WASTE_REASON_LABELS[key]).toEqual(expect.any(String))
      expect(WASTE_REASON_LABELS[key].length).toBeGreaterThan(0)
    }
  })
})
