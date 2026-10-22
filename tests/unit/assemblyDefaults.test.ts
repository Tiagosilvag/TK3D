import { describe, it, expect } from 'vitest'
import { planDefaultAssembly } from '@/lib/assemblyDefaults'
import type { AssemblyStatus, AssemblyPartColorOption } from '@/actions/assembly'

const opt = (key: string, available: number): AssemblyPartColorOption => ({ key, filamentIds: [key], label: key, available, colorHex: null, colors: [], material: null })

function status(over: Partial<AssemblyStatus>): AssemblyStatus {
  return {
    productId: 'p', productName: 'P', isComposite: true, parts: [], components: [], accessoryRequirements: [], supplyRequirements: [], packagingRequirements: [], maxAssemblableUnits: 0,
    ...over,
  } as AssemblyStatus
}
const part = (partId: string, name: string, options: AssemblyPartColorOption[] | null, qpu = 1) => ({
  partId, name, quantityPerUnit: qpu, produced: 0, consumed: 0, available: 0,
  maxUnitsFromThisPart: options ? Math.max(...options.map((o) => Math.floor(o.available / qpu))) : 0, colorOptions: options,
})

describe('planDefaultAssembly', () => {
  it('sem pedido: maior estoque por peça; máximo = menor cobertura', () => {
    const s = status({ parts: [part('a', 'CORPO', [opt('x', 2), opt('y', 5)]), part('b', 'CHARM', [opt('z', 3)])] })
    const plan = planDefaultAssembly(s, null)
    expect(plan.colorChoices).toEqual({ a: 'y', b: 'z' })
    expect(plan.maxUnits).toBe(3)
  })
  it('combinação pedida tem prioridade e limita o máximo', () => {
    const s = status({ parts: [part('a', 'CORPO', [opt('x', 2), opt('y', 5)])] })
    const plan = planDefaultAssembly(s, { a: 'x' })
    expect(plan.colorChoices).toEqual({ a: 'x' })
    expect(plan.maxUnits).toBe(2)
  })
  it('peça sem estoque na cor pedida trava (0) e aparece em limiting', () => {
    const s = status({ parts: [part('a', 'CORPO', [opt('x', 0), opt('y', 5)]), part('b', 'CHARM', [opt('z', 3)])] })
    const plan = planDefaultAssembly(s, { a: 'x' })
    expect(plan.maxUnits).toBe(0)
    expect(plan.limiting).toContain('CORPO')
  })
  it('respeita por-unidade (floor)', () => {
    const s = status({ parts: [part('a', 'ANEL', [opt('x', 7)], 2)] })
    expect(planDefaultAssembly(s, null).maxUnits).toBe(3)
  })
  it('acessório com cor: registrado com estoque; insumos vêm da ficha; não bloqueiam', () => {
    const s = status({
      parts: [part('a', 'P', [opt('x', 4)])],
      accessoryRequirements: [
        { id: 'acc1', name: 'Corrente', quantityPerUnit: 1, available: 0, colorOptions: [opt('acc1', 0), opt('acc2', 38)] },
        { id: 'acc3', name: 'Elo', quantityPerUnit: 2, available: 9, colorOptions: null },
      ],
      supplyRequirements: [{ id: 'sup1', name: 'Cola', quantityPerUnit: 3, available: 0, colorOptions: null }],
    })
    const plan = planDefaultAssembly(s, null)
    expect(plan.maxUnits).toBe(4)
    expect(plan.colorChoices.acc1).toBe('acc2')
    expect(plan.accessoryUsages).toEqual([{ id: 'acc3', quantityPerUnit: 2 }, { id: 'acc2', quantityPerUnit: 1 }])
    expect(plan.supplyUsages).toEqual([{ id: 'sup1', quantityPerUnit: 3 }])
  })
})
