import { describe, it, expect } from 'vitest'
import { buildPlateAutofill } from '@/lib/bambu/autofill'

const finishedCapture = { durationHours: 2, gramsUsedTotal: 25, outcome: 'FINISHED' as const }
const failedCapture = { durationHours: 1, gramsUsedTotal: null, outcome: 'FAILED' as const }

describe('buildPlateAutofill', () => {
  it('job concluído com 1 item só: preenche tempo real da Plate e desperdício do item pela diferença', () => {
    const result = buildPlateAutofill(finishedCapture, [{ key: 'item-1', theoreticalGramsUsed: 20 }])
    expect(result.actualPrintTimeHours).toBe(2)
    expect(result.timeWastedHoursByItem).toEqual({})
    expect(result.gramsWastedByItem).toEqual({ 'item-1': 5 })
    expect(result.referenceGramsUsedTotal).toBe(25)
  })

  it('job concluído com vários itens: não reparte filamento, só mostra referência', () => {
    const result = buildPlateAutofill(finishedCapture, [
      { key: 'item-1', theoreticalGramsUsed: 10 },
      { key: 'item-2', theoreticalGramsUsed: 10 },
    ])
    expect(result.gramsWastedByItem).toEqual({})
    expect(result.referenceGramsUsedTotal).toBe(25)
    expect(result.actualPrintTimeHours).toBe(2)
  })

  it('job com falha: duração vai pra timeWastedHours de todo item, nunca pra actualPrintTimeHours', () => {
    const result = buildPlateAutofill(failedCapture, [{ key: 'item-1', theoreticalGramsUsed: 20 }])
    expect(result.actualPrintTimeHours).toBeNull()
    expect(result.timeWastedHoursByItem).toEqual({ 'item-1': 1 })
    expect(result.gramsWastedByItem).toEqual({})
  })

  it('diferença negativa (real menor que teórico) nunca vira desperdício negativo', () => {
    const result = buildPlateAutofill(
      { durationHours: 1, gramsUsedTotal: 5, outcome: 'FINISHED' },
      [{ key: 'item-1', theoreticalGramsUsed: 20 }],
    )
    expect(result.gramsWastedByItem).toEqual({ 'item-1': 0 })
  })

  it('sem gramsUsedTotal (delta não confiável): não preenche desperdício, só duração', () => {
    const result = buildPlateAutofill(
      { durationHours: 2, gramsUsedTotal: null, outcome: 'FINISHED' },
      [{ key: 'item-1', theoreticalGramsUsed: 20 }],
    )
    expect(result.gramsWastedByItem).toEqual({})
    expect(result.referenceGramsUsedTotal).toBeNull()
    expect(result.actualPrintTimeHours).toBe(2)
  })
})
