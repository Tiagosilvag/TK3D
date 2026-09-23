import { todayInBrasilia } from './timezone'

// 3.1 Filtro por período: mesmo padrão De/Até em Produção, Vendas, Entregas
// em consignação e Relatórios de venda. Sem filtro na URL, o padrão ao
// abrir é "últimos 30 dias" — calculado aqui e usado tanto no filtro real
// quanto no defaultValue dos campos de data, pra tela sempre mostrar o
// período que está de fato aplicado.
//
// "Hoje" vem de todayInBrasilia() (lib/timezone.ts), nunca de
// `new Date()` cru -- o container roda em UTC, então perto da virada do
// dia em Brasília (21h-meia-noite) um `new Date().toISOString()` direto
// já mostrava o dia seguinte.
function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export interface DateRangeParams {
  from?: string
  to?: string
}

export interface ResolvedDateRange {
  from: string
  to: string
  // Intervalo pronto pra usar num filtro Prisma { gte, lte } sobre um
  // campo DateTime -- "to" cobre o dia inteiro (23:59:59.999), não só a
  // meia-noite.
  gte: Date
  lte: Date
}

export function resolveDateRange(params: DateRangeParams, daysBack = 30): ResolvedDateRange {
  const today = todayInBrasilia()
  const defaultFrom = todayInBrasilia()
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - daysBack)

  const from = params.from || toDateInputValue(defaultFrom)
  const to = params.to || toDateInputValue(today)

  const gte = new Date(from)
  const lte = new Date(to)
  // setUTCHours, não setHours -- "from"/"to" são datas-só (meia-noite UTC,
  // mesma convenção de todo DateTime data-only do app), então o fim do dia
  // também tem que ser fixado em UTC pra não depender do fuso do processo.
  lte.setUTCHours(23, 59, 59, 999)

  return { from, to, gte, lte }
}
