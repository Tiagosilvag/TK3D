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

export function brasiliaDateParts(date: Date): { year: number; month: number; day: number } {
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

// Bug "venda/entrega no mesmo dia da montagem desaparece do rastreio":
// lib/productUnitTrail.ts ordena os eventos de um produto (montagem,
// entrega, devolução, venda) por data pra reconstruir por FIFO quem foi
// pra onde. Dois tipos BEM diferentes de campo de data entram nessa
// ordenação:
//   - timestamp REAL (`ProductAssembly.assembledAt` @default(now()),
//     `ConsignmentDelivery.lastReturnedAt` gravado como `new Date()`) --
//     hora exata do clique, pode cair em qualquer fuso/hora do dia.
//   - campo "só data" (`ConsignmentDelivery.deliveryDate`,
//     `ConsignmentSaleReport.reportDate`, `Sale.saleDate`,
//     `ProductionRun.date` -- todos de um <input type="date">) -- SEMPRE
//     meia-noite UTC, por convenção do app inteiro (mesma de
//     todayInBrasilia() acima): "meia-noite UTC do dia X" representa
//     literalmente "dia X", nunca é convertida pro fuso de Brasília em
//     lugar nenhum (`.toISOString().slice(0,10)` já devolve "dia X" de
//     volta direto).
// Comparar os dois tipos pelo timestamp cru sempre ordenava a
// entrega/venda do MESMO dia calendário ANTES da montagem (meia-noite <
// qualquer hora depois dela) -- o motor de FIFO achava que a entrega
// aconteceu antes de existir peça nenhuma pra entregar, "perdendo" a
// unidade (sobra fantasma em "Em estoque", venda some do contador
// "Vendidas") mesmo com o dado 100% certo. A ARMADILHA: reduzir TUDO ao
// dia-calendário em Brasília (via Intl, convertendo fuso) parece a
// correção óbvia, mas quebra pro campo "só data" -- meia-noite UTC do
// dia 12 já é 21h do dia 11 em Brasília (UTC-3), então
// brasiliaDayKey(deliveryDate) devolveria 11, não 12 (o dia que a pessoa
// digitou). Por isso duas funções, uma pra cada convenção -- nunca a
// mesma Date passa pelas duas.
//
// Pra timestamp REAL: dia-calendário em Brasília de verdade (converte
// fuso, igual todayInBrasiliaString).
export function brasiliaDayKey(date: Date): number {
  const { year, month, day } = brasiliaDateParts(date)
  return year * 10000 + month * 100 + day
}

// Pra campo "só data" (sempre meia-noite UTC): lê os componentes em UTC
// direto, sem converter fuso nenhum -- "meia-noite UTC do dia 12" já É o
// dia 12 por convenção, não precisa (e não pode) passar por Brasília.
// Mesma escala de inteiro de brasiliaDayKey (ano*10000+mês*100+dia), as
// duas são diretamente comparáveis entre si.
export function utcDayKey(date: Date): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
}
