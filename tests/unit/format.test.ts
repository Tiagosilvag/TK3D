import { describe, it, expect } from 'vitest'
import { getProductionStatusBadge, WASTE_REASON_LABELS, getOrderItemDisplayStatus, summarizeOrderEditChanges } from '@/lib/format'
import type { ProductionStatus, WasteReason, OrderStatus } from '@prisma/client'

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

// Redesign "Pedidos": decisão confirmada com o usuário -- "Em produção"
// (roxo) é só um rótulo novo pro status PARCIAL_AGUARDANDO_PRODUCAO já
// existente, sem schema novo. Os 4 buckets de cor usados pela
// lista/drawer novos (barra segmentada) cobrem os 11 valores do enum,
// legados inclusos (nunca mais escritos, mas ainda podem existir em
// linha antiga).
describe('getOrderItemDisplayStatus', () => {
  const cases: [OrderStatus, string][] = [
    ['AGUARDANDO_PRODUCAO', 'Aguardando produção'],
    ['AGUARDANDO_MONTAGEM', 'Aguardando produção'],
    ['PARCIAL_AGUARDANDO_PRODUCAO', 'Em produção'],
    ['PRONTO_RESERVADO', 'Pronto'],
    ['ENTREGUE', 'Entregue'],
    ['CANCELADO', 'Cancelado'],
    ['RECEBIDO', 'Aguardando produção'],
    ['EM_PRODUCAO', 'Em produção'],
    ['PRONTO', 'Pronto'],
    ['DESPACHADO', 'Pronto'],
    ['CONCLUIDO', 'Entregue'],
  ]

  it.each(cases)('%s -> label %s', (status, label) => {
    const display = getOrderItemDisplayStatus(status)
    expect(display.label).toBe(label)
    expect(display.badgeClassName.length).toBeGreaterThan(0)
    expect(display.barClassName.length).toBeGreaterThan(0)
  })
})

describe('summarizeOrderEditChanges', () => {
  it('returns empty string for no changes', () => {
    expect(summarizeOrderEditChanges([])).toBe('')
  })

  it('joins up to 2 changes without a +N suffix', () => {
    const summary = summarizeOrderEditChanges([
      { label: 'Monster Moletom: quantidade', from: '1', to: '2' },
      { label: 'Monster Moletom: valor', from: 'R$ 49,90', to: 'R$ 59,90' },
    ])
    expect(summary).toBe('Monster Moletom: quantidade 1 → 2 · Monster Moletom: valor R$ 49,90 → R$ 59,90')
  })

  it('shows only the first 2 changes plus a +N suffix when there are more', () => {
    const summary = summarizeOrderEditChanges([
      { label: 'A', from: '1', to: '2' },
      { label: 'B', from: '1', to: '2' },
      { label: 'C', from: '1', to: '2' },
    ])
    expect(summary).toBe('A 1 → 2 · B 1 → 2 · +1')
  })
})
