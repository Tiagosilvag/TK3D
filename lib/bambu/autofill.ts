export type PlateAutofillCapture = {
  durationHours: number
  gramsUsedTotal: number | null
  outcome: 'FINISHED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN'
}

export type PlateAutofillItem = {
  key: string
  theoreticalGramsUsed: number
}

export type PlateAutofillResult = {
  actualPrintTimeHours: number | null
  timeWastedHoursByItem: Record<string, number>
  gramsWastedByItem: Record<string, number>
  referenceGramsUsedTotal: number | null
}

// Mapeamento da spec §7: sucesso -> Plate.actualPrintTimeHours; falha ->
// timeWastedHours (campo já existe com esse sentido). Filamento só é
// repartido automaticamente quando a Plate tem 1 item só -- com vários
// itens não dá pra saber qual consumiu o quê, então fica só como
// referência (nunca inventa a divisão).
export function buildPlateAutofill(capture: PlateAutofillCapture, items: PlateAutofillItem[]): PlateAutofillResult {
  const isFailure = capture.outcome === 'FAILED'

  const timeWastedHoursByItem: Record<string, number> = {}
  if (isFailure) {
    for (const item of items) timeWastedHoursByItem[item.key] = capture.durationHours
  }

  const gramsWastedByItem: Record<string, number> = {}
  if (!isFailure && items.length === 1 && capture.gramsUsedTotal !== null) {
    const [only] = items
    gramsWastedByItem[only.key] = Math.max(0, capture.gramsUsedTotal - only.theoreticalGramsUsed)
  }

  return {
    actualPrintTimeHours: isFailure ? null : capture.durationHours,
    timeWastedHoursByItem,
    gramsWastedByItem,
    referenceGramsUsedTotal: isFailure ? null : capture.gramsUsedTotal,
  }
}
