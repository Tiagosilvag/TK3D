import { describe, it, expect } from 'vitest'
import { serializeColorChoices, deserializeColorChoices } from '@/lib/reports'
import { maxAssemblableUnitsForCombo } from '@/lib/orderReservations'
import type { AssemblyStatus, AssemblyPartStatus } from '@/actions/assembly'

describe('serializeColorChoices / deserializeColorChoices', () => {
  it('é um round-trip: deserializar o que foi serializado devolve o mapa original', () => {
    const choices = { partB: 'fil-2', partA: 'fil-1,fil-3' }
    const key = serializeColorChoices(choices)
    expect(deserializeColorChoices(key)).toEqual(choices)
  })

  it('serializa em ordem alfabética de partId, independente da ordem de inserção', () => {
    expect(serializeColorChoices({ z: '1', a: '2' })).toBe('a:2|z:1')
  })

  it('mapa de 1 peça só', () => {
    const key = serializeColorChoices({ cabeca: 'vermelho' })
    expect(key).toBe('cabeca:vermelho')
    expect(deserializeColorChoices(key)).toEqual({ cabeca: 'vermelho' })
  })
})

function makeStatus(parts: AssemblyPartStatus[], maxAssemblableUnits = 0): AssemblyStatus {
  return {
    productId: 'p1',
    productName: 'Produto Teste',
    isComposite: true,
    parts,
    components: [],
    accessoryRequirements: [],
    supplyRequirements: [],
    packagingRequirements: [],
    maxAssemblableUnits,
    alreadyAssembled: 0,
  }
}

function variablePart(overrides: Partial<AssemblyPartStatus> & { partId: string; quantityPerUnit: number }): AssemblyPartStatus {
  return {
    name: overrides.partId,
    produced: 0,
    consumed: 0,
    available: 0,
    maxUnitsFromThisPart: 0,
    colorOptions: [],
    ...overrides,
  }
}

describe('maxAssemblableUnitsForCombo', () => {
  it('colorComboKey null: devolve status.maxAssemblableUnits direto (comportamento antigo intacto)', () => {
    const status = makeStatus([], 7)
    expect(maxAssemblableUnitsForCombo(status, null)).toBe(7)
  })

  it('combo disponível em todas as peças: mínimo entre floor(available/quantityPerUnit) de cada peça', () => {
    const status = makeStatus([
      variablePart({ partId: 'cabeca', quantityPerUnit: 1, colorOptions: [{ key: 'vermelho', filamentIds: ['vermelho'], label: 'Vermelho', available: 10, colorHex: '#f00' }] }),
      variablePart({ partId: 'corpo', quantityPerUnit: 2, colorOptions: [{ key: 'azul', filamentIds: ['azul'], label: 'Azul', available: 10, colorHex: '#00f' }] }),
    ])
    const comboKey = serializeColorChoices({ cabeca: 'vermelho', corpo: 'azul' })
    // cabeca: floor(10/1)=10, corpo: floor(10/2)=5 -- mínimo é 5
    expect(maxAssemblableUnitsForCombo(status, comboKey)).toBe(5)
  })

  it('bug corrigido: combo zerado pra ESSA cor não conta disponível de OUTRA cor da mesma peça', () => {
    const status = makeStatus([
      variablePart({
        partId: 'cabeca',
        quantityPerUnit: 1,
        colorOptions: [
          { key: 'vermelho', filamentIds: ['vermelho'], label: 'Vermelho', available: 0, colorHex: '#f00' },
          { key: 'azul', filamentIds: ['azul'], label: 'Azul', available: 20, colorHex: '#00f' },
        ],
      }),
    ], 20) // maxAssemblableUnits "cego à cor" veria 20 disponível (a soma/melhor cor)
    const comboKey = serializeColorChoices({ cabeca: 'vermelho' })
    expect(maxAssemblableUnitsForCombo(status, comboKey)).toBe(0)
  })

  it('peça de receita fixa (colorOptions null) ignora o combo -- usa maxUnitsFromThisPart normal', () => {
    const status = makeStatus([
      { partId: 'base', name: 'Base', quantityPerUnit: 1, produced: 10, consumed: 0, available: 10, maxUnitsFromThisPart: 4, colorOptions: null },
    ])
    const comboKey = serializeColorChoices({ outraPeca: 'x' })
    expect(maxAssemblableUnitsForCombo(status, comboKey)).toBe(4)
  })

  it('peça sem escolha no combo (nunca produzida nessa cor): 0', () => {
    const status = makeStatus([
      variablePart({ partId: 'cabeca', quantityPerUnit: 1, colorOptions: [{ key: 'vermelho', filamentIds: ['vermelho'], label: 'Vermelho', available: 10, colorHex: '#f00' }] }),
    ])
    const comboKey = serializeColorChoices({ cabeca: 'verde' })
    expect(maxAssemblableUnitsForCombo(status, comboKey)).toBe(0)
  })

  it('sem peças: 0', () => {
    const status = makeStatus([])
    expect(maxAssemblableUnitsForCombo(status, serializeColorChoices({ x: 'y' }))).toBe(0)
  })
})
