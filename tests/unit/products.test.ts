import { describe, expect, it } from 'vitest'
import { productAutoAssembles } from '@/lib/products'

describe('productAutoAssembles', () => {
  it('produto não-composto nunca auto-monta', () => {
    expect(productAutoAssembles({ isComposite: false, accessoryUsagesCount: 0, supplyUsagesCount: 0, componentUsagesCount: 0, parts: [] })).toBe(false)
  })

  it('composto de 1 peça só, proporção 1:1, sem insumo/acessório/componente -- auto-monta', () => {
    expect(productAutoAssembles({ isComposite: true, accessoryUsagesCount: 0, supplyUsagesCount: 0, componentUsagesCount: 0, parts: [{ quantityPerUnit: 1 }] })).toBe(true)
  })

  it('composto de 2+ peças exige montagem manual', () => {
    expect(productAutoAssembles({ isComposite: true, accessoryUsagesCount: 0, supplyUsagesCount: 0, componentUsagesCount: 0, parts: [{ quantityPerUnit: 1 }, { quantityPerUnit: 1 }] })).toBe(false)
  })

  it('composto de 1 peça mas quantityPerUnit > 1 exige montagem manual', () => {
    expect(productAutoAssembles({ isComposite: true, accessoryUsagesCount: 0, supplyUsagesCount: 0, componentUsagesCount: 0, parts: [{ quantityPerUnit: 2 }] })).toBe(false)
  })

  it('composto de 1 peça com acessório cadastrado exige montagem manual', () => {
    expect(productAutoAssembles({ isComposite: true, accessoryUsagesCount: 1, supplyUsagesCount: 0, componentUsagesCount: 0, parts: [{ quantityPerUnit: 1 }] })).toBe(false)
  })

  it('composto de 1 peça com insumo cadastrado exige montagem manual', () => {
    expect(productAutoAssembles({ isComposite: true, accessoryUsagesCount: 0, supplyUsagesCount: 1, componentUsagesCount: 0, parts: [{ quantityPerUnit: 1 }] })).toBe(false)
  })

  it('composto de 1 peça com componente-produto cadastrado exige montagem manual', () => {
    expect(productAutoAssembles({ isComposite: true, accessoryUsagesCount: 0, supplyUsagesCount: 0, componentUsagesCount: 1, parts: [{ quantityPerUnit: 1 }] })).toBe(false)
  })
})
