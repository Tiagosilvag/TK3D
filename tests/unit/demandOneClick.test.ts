import { describe, it, expect } from 'vitest'
import { buildOneClickItem, rollShortfalls, groupByOrderItem } from '@/lib/demandOneClick'
import type { ProductProductionDefaults } from '@/actions/products'

const composite: ProductProductionDefaults = {
  isComposite: true,
  parts: [
    { id: 'corpo', name: 'CORPO', printerId: 'p1', filaments: [{ filamentId: 'preto', weightGrams: 14.2 }], printTimeHours: 0.6 },
    { id: 'multi', name: 'MULTI', printerId: 'p1', filaments: [{ filamentId: 'a', weightGrams: 10 }, { filamentId: 'b', weightGrams: 5 }], printTimeHours: 1 },
  ],
}
const simple: ProductProductionDefaults = { isComposite: false, printerId: 'p2', filamentId: 'azul', weightGrams: 20, printTimeHours: 0.5 }

describe('buildOneClickItem', () => {
  it('usa ficha da peça; planejada = sucesso = quantidade', () => {
    const r = buildOneClickItem({ productId: 'x', partId: 'corpo', filamentIds: null, quantity: 3 }, composite, '2026-10-21')
    expect(r).toMatchObject({ productPartId: 'corpo', printerId: 'p1', quantityPlanned: 3, quantitySuccess: 3, date: '2026-10-21' })
    expect('filaments' in r && r.filaments).toEqual([{ filamentId: 'preto', weightGramsPerUnit: 14.2, gramsWasted: 0 }])
  })
  it('peça de 1 filamento usa a cor pedida; receita fixa ignora', () => {
    const one = buildOneClickItem({ productId: 'x', partId: 'corpo', filamentIds: ['vermelho'], quantity: 1 }, composite, 'd')
    expect('filaments' in one && one.filaments[0].filamentId).toBe('vermelho')
    const multi = buildOneClickItem({ productId: 'x', partId: 'multi', filamentIds: ['vermelho'], quantity: 1 }, composite, 'd')
    expect('filaments' in multi && multi.filaments.map((f) => f.filamentId)).toEqual(['a', 'b'])
  })
  it('produto simples usa filamento/peso do produto', () => {
    const r = buildOneClickItem({ productId: 'x', partId: null, filamentIds: null, quantity: 2 }, simple, 'd')
    expect('filaments' in r && r.filaments).toEqual([{ filamentId: 'azul', weightGramsPerUnit: 20, gramsWasted: 0 }])
  })
  it('erro quando falta ficha ou quantidade inválida', () => {
    expect(buildOneClickItem({ productId: 'x', partId: 'nao', filamentIds: null, quantity: 1 }, composite, 'd')).toHaveProperty('error')
    expect(buildOneClickItem({ productId: 'x', partId: null, filamentIds: null, quantity: 0 }, simple, 'd')).toHaveProperty('error')
    expect(buildOneClickItem({ productId: 'x', partId: null, filamentIds: null, quantity: 1 }, { isComposite: false, printerId: null, filamentId: null, weightGrams: 0, printTimeHours: 0 } as unknown as ProductProductionDefaults, 'd')).toHaveProperty('error')
  })
})

describe('rollShortfalls', () => {
  const item = (filamentId: string, w: number, q: number) => ({ quantityPlanned: q, filaments: [{ filamentId, weightGramsPerUnit: w, gramsWasted: 0 }] })
  it('soma por rolo: cada peça cabe sozinha, juntas não', () => {
    const stock = new Map([['preto', 150]])
    expect(rollShortfalls([item('preto', 100, 1)], stock)).toEqual([])
    expect(rollShortfalls([item('preto', 100, 1), item('preto', 100, 1)], stock)).toEqual([{ filamentId: 'preto', needed: 200, available: 150 }])
  })
  it('rolo desconhecido = 0 g', () => {
    expect(rollShortfalls([item('x', 1, 1)], new Map())).toHaveLength(1)
  })
})

describe('groupByOrderItem', () => {
  it('agrupa mantendo a ordem de chegada', () => {
    const g = groupByOrderItem([{ orderItemId: 'a', n: 1 }, { orderItemId: 'b', n: 2 }, { orderItemId: 'a', n: 3 }])
    expect(g.map((x) => [x.orderItemId, x.rows.length])).toEqual([['a', 2], ['b', 1]])
  })
})

import { rollTotals } from '@/lib/demandOneClick'

describe('rollTotals', () => {
  it('soma o consumo (gramas × planejada + desperdício) por rolo entre as linhas', () => {
    const totals = rollTotals(
      [
        { quantityPlanned: 2, filaments: [{ filamentId: 'preto', weightGramsPerUnit: 10, gramsWasted: 1 }] },
        { quantityPlanned: 3, filaments: [{ filamentId: 'preto', weightGramsPerUnit: 5, gramsWasted: 0 }, { filamentId: 'branco', weightGramsPerUnit: 2, gramsWasted: 0 }, { filamentId: '', weightGramsPerUnit: 9, gramsWasted: 0 }] },
      ],
      new Map([['preto', 40]]),
    )
    expect(totals.get('preto')).toEqual({ used: 36, available: 40 })
    expect(totals.get('branco')).toEqual({ used: 6, available: 0 })
    expect(totals.has('')).toBe(false)
  })
})
