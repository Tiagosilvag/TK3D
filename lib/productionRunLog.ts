// Resumo legível do que mudou numa produção editada -- guardado no registro de
// alterações (ProductionRunLog) e mostrado na tela de edição.
export interface RunComparable {
  date: string
  printerId: string
  timeWastedHours: number
  wasteReason: string | null
  notes: string | null
  quantityPlanned: number
  quantitySuccess: number
  filaments: { filamentId: string; weightGramsPerUnit: number; gramsWasted: number }[]
}

const round = (n: number) => Math.round(n * 100) / 100

export function summarizeRunChange(before: RunComparable, after: RunComparable): string {
  const parts: string[] = []
  if (before.quantityPlanned !== after.quantityPlanned) parts.push(`Planejada ${before.quantityPlanned} → ${after.quantityPlanned}`)
  if (before.quantitySuccess !== after.quantitySuccess) parts.push(`Sucesso ${before.quantitySuccess} → ${after.quantitySuccess}`)
  const failedBefore = before.quantityPlanned - before.quantitySuccess
  const failedAfter = after.quantityPlanned - after.quantitySuccess
  if (failedBefore !== failedAfter) parts.push(`Falhas ${failedBefore} → ${failedAfter}`)

  const ids = (r: RunComparable) => [...new Set(r.filaments.map((f) => f.filamentId))].sort().join(',')
  if (ids(before) !== ids(after)) {
    parts.push(before.filaments.length !== after.filaments.length ? `Cores ${before.filaments.length} → ${after.filaments.length}` : 'Filamento trocado')
  }
  const gramsBefore = before.filaments.reduce((s, f) => s + f.weightGramsPerUnit * before.quantityPlanned, 0)
  const gramsAfter = after.filaments.reduce((s, f) => s + f.weightGramsPerUnit * after.quantityPlanned, 0)
  if (round(gramsBefore) !== round(gramsAfter)) parts.push(`Gramas ${round(gramsBefore)} → ${round(gramsAfter)} g`)
  const wastedBefore = before.filaments.reduce((s, f) => s + f.gramsWasted, 0)
  const wastedAfter = after.filaments.reduce((s, f) => s + f.gramsWasted, 0)
  if (round(wastedBefore) !== round(wastedAfter)) parts.push(`Desperdício ${round(wastedBefore)} → ${round(wastedAfter)} g`)

  if (before.date !== after.date) parts.push(`Data ${before.date} → ${after.date}`)
  if (before.printerId !== after.printerId) parts.push('Impressora trocada')
  if (round(before.timeWastedHours) !== round(after.timeWastedHours)) parts.push(`Tempo desperdiçado ${round(before.timeWastedHours)} → ${round(after.timeWastedHours)} h`)
  if ((before.wasteReason ?? '') !== (after.wasteReason ?? '')) parts.push('Motivo do desperdício alterado')
  if ((before.notes ?? '') !== (after.notes ?? '')) parts.push('Observações alteradas')
  return parts.length > 0 ? parts.join(' · ') : 'Salvo sem mudanças'
}
