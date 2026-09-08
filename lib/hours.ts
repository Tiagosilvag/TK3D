// 3.8: campos de duração (tempo de impressão, mão de obra, tempo
// desperdiçado) aceitam HH:MM em vez de uma fração decimal difícil de
// digitar de cabeça (ex.: "1h30" vira 1.5) -- estas duas funções convertem
// entre a representação visível (HH:MM) e o número decimal que o restante
// do app (validação, cálculo de custo) já espera receber.
export function decimalHoursToHHMM(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) hours = 0
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function hhmmToDecimalHours(value: string): number {
  const match = value.trim().match(/^(\d{1,4}):([0-5]?\d)$/)
  if (!match) return 0
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  return hours + minutes / 60
}
