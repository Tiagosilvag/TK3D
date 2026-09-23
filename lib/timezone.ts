// Bug "data errada perto da virada do dia": vários lugares do app
// calculavam "hoje" com `new Date().toISOString().slice(0, 10)` --
// toISOString() SEMPRE devolve o horário em UTC, nunca no fuso de quem
// está rodando. O host do Coolify está com o relógio certo
// (America/Sao_Paulo), mas o container Docker do Next.js roda em UTC por
// padrão (não herda o fuso do host) -- então entre ~21h e meia-noite
// (horário de Brasília, UTC-3), o servidor já tinha "virado o dia" em
// UTC e todo default de data (campo Data de formulário, filtro de
// período, prazo de pedido) saía um dia à frente. O mesmo bug existe do
// lado do navegador se o usuário estiver numa máquina com fuso diferente.
// Estes helpers fixam TUDO em America/Sao_Paulo explicitamente -- únicos
// pontos do app que devem calcular "hoje"; nenhum outro lugar deve voltar
// a usar `new Date().toISOString()`/`setHours(0,0,0,0)` cru pra isso.
export const BRASILIA_TIME_ZONE = 'America/Sao_Paulo'

function brasiliaDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRASILIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) }
}

// "Hoje" em Brasília, como string YYYY-MM-DD -- pro valor de
// <input type="date">/defaultValue de formulário.
export function todayInBrasiliaString(): string {
  const { year, month, day } = brasiliaDateParts(new Date())
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Mesmo dia, como Date em meia-noite UTC -- a mesma convenção que
// `new Date('YYYY-MM-DD')` já usa em todo o app pra campo de data-only
// (round-trip seguro com `.toISOString().slice(0, 10)` depois, e
// diretamente comparável com qualquer outra data gravada assim, ex.:
// Order.deliveryDate).
export function todayInBrasilia(): Date {
  return new Date(todayInBrasiliaString())
}
