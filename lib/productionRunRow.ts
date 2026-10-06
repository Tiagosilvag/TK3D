// Melhoria "Produção" §3: Planejada/Sucesso/Falhas totalmente interligados --
// os helpers abaixo são a única fonte de verdade pra recalcular os outros
// dois campos quando um muda. Extraído de ProductionRunBatchForm.tsx (onde
// viviam como funções privadas) pra ser reaproveitado também pelo registro
// em lote a partir da fila de demanda (DemandBatchRegisterForm.tsx) -- as 3
// telas (peça de produto, item de Plate, linha da fila de demanda) operam
// sobre o MESMO shape de quantityPlanned/quantitySuccess/filaments, nunca
// duplicando esta lógica.
export interface FilamentComponentRow {
  filamentId: string
  weightGramsPerUnit: string
  gramsWasted: string
}

export function failedFor(row: { quantityPlanned: string; quantitySuccess: string }): number {
  const planned = parseInt(row.quantityPlanned, 10) || 0
  const success = parseInt(row.quantitySuccess, 10) || 0
  return Math.max(0, planned - success)
}

export function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function suggestWaste<T extends { filaments: FilamentComponentRow[] }>(row: T, failed: number): Partial<T> {
  if (row.filaments.length !== 1) return {}
  const weightPerUnit = parseFloat(row.filaments[0].weightGramsPerUnit) || 0
  return { filaments: [{ ...row.filaments[0], gramsWasted: String(+(failed * weightPerUnit).toFixed(2)) }] } as Partial<T>
}

export function plannedChangePatch<T extends { quantityPlanned: string; quantitySuccess: string; filaments: FilamentComponentRow[] }>(
  row: T,
  newPlannedRaw: string,
): Partial<T> {
  const newPlanned = Math.max(0, parseInt(newPlannedRaw, 10) || 0)
  const failed = Math.min(failedFor(row), newPlanned)
  const success = newPlanned - failed
  return { quantityPlanned: String(newPlanned), quantitySuccess: String(success), ...suggestWaste(row, failed) } as Partial<T>
}

export function successChangePatch<T extends { quantityPlanned: string; filaments: FilamentComponentRow[] }>(row: T, newSuccessRaw: string): Partial<T> {
  const planned = parseInt(row.quantityPlanned, 10) || 0
  const success = clampInt(parseInt(newSuccessRaw, 10) || 0, 0, planned)
  const failed = planned - success
  return { quantitySuccess: String(success), ...suggestWaste(row, failed) } as Partial<T>
}

export function failedChangePatch<T extends { quantityPlanned: string; filaments: FilamentComponentRow[] }>(row: T, newFailedRaw: string): Partial<T> {
  const planned = parseInt(row.quantityPlanned, 10) || 0
  const failed = clampInt(parseInt(newFailedRaw, 10) || 0, 0, planned)
  const success = planned - failed
  return { quantitySuccess: String(success), ...suggestWaste(row, failed) } as Partial<T>
}
