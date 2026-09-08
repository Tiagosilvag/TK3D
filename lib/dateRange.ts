// 3.1 Filtro por período: mesmo padrão De/Até em Produção, Vendas, Entregas
// em consignação e Relatórios de venda. Sem filtro na URL, o padrão ao
// abrir é "últimos 30 dias" — calculado aqui e usado tanto no filtro real
// quanto no defaultValue dos campos de data, pra tela sempre mostrar o
// período que está de fato aplicado.
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
  const today = new Date()
  const defaultFrom = new Date()
  defaultFrom.setDate(defaultFrom.getDate() - daysBack)

  const from = params.from || toDateInputValue(defaultFrom)
  const to = params.to || toDateInputValue(today)

  const gte = new Date(from)
  const lte = new Date(to)
  lte.setHours(23, 59, 59, 999)

  return { from, to, gte, lte }
}
