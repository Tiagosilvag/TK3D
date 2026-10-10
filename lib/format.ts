import type { ProductionStatus, WasteReason, SupplyUnit, OrderStatus, OrderChannel, StockAdjustmentReason, SaleChannel, ListingStatus, ListingFreightType, ListingType, MarketplacePlatformKind } from '@prisma/client'
import type { StockStatus } from '@/lib/costing'
import { todayInBrasilia } from '@/lib/timezone'

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

// Sufixo de unidade de medida usado no "Custo por unidade" de Insumos (ex.:
// "R$ 25,55/g", "R$ 0,12/ml", "R$ 3,40/m").
export const SUPPLY_UNIT_SUFFIX: Record<SupplyUnit, string> = { UN: 'un', ML: 'ml', G: 'g', M: 'm', OUTRO: 'un' }

export function formatUnitCost(unit: SupplyUnit, value: number): string {
  return `${formatCurrency(value)}/${SUPPLY_UNIT_SUFFIX[unit]}`
}

// Task 8 (spec §5.4/§6, task-8 brief): production history renders a colored
// pill badge per ProductionStatus, reusing the rounded-full pill convention
// already used for Sale.channel (app/(app)/sales/page.tsx) rather than
// inventing a new visual pattern. Colors follow the brief's suggestion:
// green=CONCLUIDA (fully successful), yellow=PARCIAL (some shortfall),
// red=COM_FALHAS (failures occurred), gray=CANCELADA (reversed, inert).
export interface StatusBadge {
  label: string
  className: string
}

const PRODUCTION_STATUS_BADGES: Record<ProductionStatus, StatusBadge> = {
  CONCLUIDA: { label: 'Concluída', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  PARCIAL: { label: 'Parcial', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  COM_FALHAS: { label: 'Com falhas', className: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' },
  CANCELADA: { label: 'Cancelada', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

export function getProductionStatusBadge(status: ProductionStatus): StatusBadge {
  return PRODUCTION_STATUS_BADGES[status]
}

// 2.4 Sistema de pedidos: badge de status (mesmo padrão de
// getProductionStatusBadge) e labels de canal. Melhoria "Pedidos com
// reserva de estoque": RECEBIDO/EM_PRODUCAO/PRONTO/DESPACHADO/CONCLUIDO
// viram legado (nunca mais escritos, ver schema.prisma) -- mantidos aqui
// só pra pedido antigo ainda renderizar algo sensato caso a
// reconciliação ainda não tenha corrigido o status dele.
const ORDER_STATUS_BADGES: Record<OrderStatus, StatusBadge> = {
  RECEBIDO: { label: 'Recebido', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  EM_PRODUCAO: { label: 'Em produção', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  PRONTO: { label: 'Pronto', className: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' },
  DESPACHADO: { label: 'Despachado', className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' },
  CONCLUIDO: { label: 'Concluído', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  AGUARDANDO_PRODUCAO: { label: 'Aguardando produção', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  PARCIAL_AGUARDANDO_PRODUCAO: { label: 'Parcial — aguardando produção', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  AGUARDANDO_MONTAGEM: { label: 'Aguardando montagem', className: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400' },
  PRONTO_RESERVADO: { label: 'Pronto — reservado', className: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' },
  ENTREGUE: { label: 'Entregue', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  CANCELADO: { label: 'Cancelado', className: 'bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500' },
}

export function getOrderStatusBadge(status: OrderStatus): StatusBadge {
  return ORDER_STATUS_BADGES[status]
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  RECEBIDO: 'Recebido',
  EM_PRODUCAO: 'Em produção',
  PRONTO: 'Pronto',
  DESPACHADO: 'Despachado',
  CONCLUIDO: 'Concluído',
  AGUARDANDO_PRODUCAO: 'Aguardando produção',
  PARCIAL_AGUARDANDO_PRODUCAO: 'Parcial — aguardando produção',
  AGUARDANDO_MONTAGEM: 'Aguardando montagem',
  PRONTO_RESERVADO: 'Pronto — reservado',
  ENTREGUE: 'Entregue',
  CANCELADO: 'Cancelado',
}

// Redesign "Pedidos": o protótipo usa 4 cores por item (Aguardando
// produção=âmbar / Em produção=roxo / Pronto=azul / Entregue=verde) em
// vez do badge de 11 valores de getOrderStatusBadge acima. Decisão
// confirmada com o usuário: não existe sinal nenhum de "imprimindo
// agora" no sistema (ProductionRun só é gravado DEPOIS de pronto) --
// "Em produção" é só um RÓTULO novo pro status PARCIAL_AGUARDANDO_PRODUCAO
// que já existe (reserved>0 mas <quantity), sem schema novo. Função
// própria (não mexe em getOrderStatusBadge/ORDER_STATUS_LABELS, que
// continuam servindo a tabela/badge "oficial" de 11 valores em outras
// telas) -- usada só pela lista/drawer novos (barra segmentada + texto
// "o que falta"). `barClassName` é a cor sólida de 1 segmento da barra
// (bg-500, sem o par bg-50/text-700 de badge); valores legados
// (RECEBIDO...CONCLUIDO, nunca mais escritos) mapeiam pro bucket mais
// parecido, só pra pedido antigo ainda renderizar algo sensato.
export interface OrderItemDisplayStatus {
  label: string
  badgeClassName: string
  barClassName: string
}

const ORDER_ITEM_DISPLAY_STATUS: Record<OrderStatus, OrderItemDisplayStatus> = {
  AGUARDANDO_PRODUCAO: { label: 'Aguardando produção', badgeClassName: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400', barClassName: 'bg-amber-500' },
  AGUARDANDO_MONTAGEM: { label: 'Aguardando produção', badgeClassName: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400', barClassName: 'bg-amber-500' },
  PARCIAL_AGUARDANDO_PRODUCAO: { label: 'Em produção', badgeClassName: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400', barClassName: 'bg-violet-500' },
  PRONTO_RESERVADO: { label: 'Pronto', badgeClassName: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400', barClassName: 'bg-sky-500' },
  ENTREGUE: { label: 'Entregue', badgeClassName: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', barClassName: 'bg-emerald-500' },
  CANCELADO: { label: 'Cancelado', badgeClassName: 'bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500', barClassName: 'bg-slate-400' },
  // Legado (nunca mais escrito) -- mapeado pro bucket mais próximo.
  RECEBIDO: { label: 'Aguardando produção', badgeClassName: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400', barClassName: 'bg-amber-500' },
  EM_PRODUCAO: { label: 'Em produção', badgeClassName: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400', barClassName: 'bg-violet-500' },
  PRONTO: { label: 'Pronto', badgeClassName: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400', barClassName: 'bg-sky-500' },
  DESPACHADO: { label: 'Pronto', badgeClassName: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400', barClassName: 'bg-sky-500' },
  CONCLUIDO: { label: 'Entregue', badgeClassName: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', barClassName: 'bg-emerald-500' },
}

export function getOrderItemDisplayStatus(status: OrderStatus): OrderItemDisplayStatus {
  return ORDER_ITEM_DISPLAY_STATUS[status]
}

// Redesign "Pedidos" -- linha "↳ o que mudou" da lista (badge "Editado"),
// derivada do OrderEditLog mais recente: mostra as 2 primeiras mudanças da
// sessão (texto já pronto como "label from → to") + "+N" se sobrar mais,
// nunca a lista inteira (isso fica só dentro do drawer, seção "Histórico
// de alterações").
export function summarizeOrderEditChanges(changes: { label: string; from: string; to: string }[]): string {
  if (changes.length === 0) return ''
  const shown = changes.slice(0, 2).map((c) => `${c.label} ${c.from} → ${c.to}`)
  const extra = changes.length - shown.length
  return shown.join(' · ') + (extra > 0 ? ` · +${extra}` : '')
}

// Melhoria "Pedidos com reserva de estoque": etiqueta de prazo com cor por
// urgência -- verde (folga), amarelo (≤3 dias), vermelho (atrasado).
// Pedido terminal (ENTREGUE/CANCELADO) nunca mostra "atrasado" (prazo
// deixou de importar pra ele).
export interface DeadlineBadge extends StatusBadge {
  daysUntil: number
}

export function getDeadlineBadge(deliveryDate: Date, status: OrderStatus): DeadlineBadge {
  const msPerDay = 1000 * 60 * 60 * 24
  // "Hoje" em Brasília (lib/timezone.ts), não `new Date()` cru -- o
  // container roda em UTC, então perto da virada do dia em Brasília um
  // pedido podia aparecer "atrasado" (ou deixar de aparecer) horas cedo
  // demais. deliveryDate já vem como meia-noite UTC do dia escolhido
  // (mesma convenção de todo DateTime data-only do app) -- comparável
  // direto com todayInBrasilia(), sem precisar de setHours.
  const today = todayInBrasilia()
  const delivery = new Date(deliveryDate)
  delivery.setUTCHours(0, 0, 0, 0)
  const daysUntil = Math.round((delivery.getTime() - today.getTime()) / msPerDay)
  const isTerminal = status === 'ENTREGUE' || status === 'CANCELADO'

  if (!isTerminal && daysUntil < 0) {
    return { daysUntil, label: `Atrasado ${Math.abs(daysUntil)}d`, className: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' }
  }
  if (!isTerminal && daysUntil <= 3) {
    return { daysUntil, label: daysUntil === 0 ? 'Hoje' : `Em ${daysUntil}d`, className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' }
  }
  return { daysUntil, label: daysUntil >= 0 ? `Em ${daysUntil}d` : `Atrasado ${Math.abs(daysUntil)}d`, className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' }
}

export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  DIRETA: 'Direta',
  SHOPEE: 'Shopee',
  MERCADO_LIVRE: 'Mercado Livre',
  CONSIGNADO: 'Consignado',
}

// 5.3: badge de canal de venda (Vendas), mesmo padrão {label, className}
// de getProductionStatusBadge/getOrderStatusBadge -- antes era montado
// inline em app/(app)/sales/page.tsx com só 2 cores (Direta/Marketplace).
const SALE_CHANNEL_BADGES: Record<SaleChannel, StatusBadge> = {
  DIRETA: { label: 'Direta', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  SHOPEE: { label: 'Shopee', className: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' },
  MERCADO_LIVRE: { label: 'Mercado Livre', className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' },
  MARKETPLACE: { label: 'Marketplace (antigo)', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

export function getSaleChannelBadge(channel: SaleChannel): StatusBadge {
  return SALE_CHANNEL_BADGES[channel]
}

// Redesign "Vendas": pílula de margem (Lucro ÷ Recebido) -- mesmas 3
// faixas em toda a tela nova (linha-resumo do grupo, linha de item
// expandida, card de KPI "Lucro líquido"), nunca uma conta repetida em
// cada lugar que precisa da cor. `margin` null (ex. Recebido = 0, sem
// base pra calcular %) cai no bucket neutro -- nunca inventa uma faixa.
const MARGIN_BADGES = {
  alta: { label: '', className: 'text-emerald-600 dark:text-emerald-400' },
  media: { label: '', className: 'text-amber-600 dark:text-amber-400' },
  baixa: { label: '', className: 'text-red-600 dark:text-red-400' },
  neutra: { label: '', className: 'text-slate-400 dark:text-slate-500' },
} as const

export function getMarginBadge(margin: number | null): StatusBadge {
  if (margin === null) return MARGIN_BADGES.neutra
  if (margin >= 0.4) return MARGIN_BADGES.alta
  if (margin >= 0.2) return MARGIN_BADGES.media
  return MARGIN_BADGES.baixa
}

// Redesign "Vendas": cabeçalho de grupo-por-dia -- "Qua 07/10/2026" (dia
// da semana abreviado capitalizado + data pt-BR). `toLocaleDateString`
// com weekday:'short' devolve algo como "qua." (minúsculo, com ponto) --
// capitalizado e sem o ponto fica mais limpo como título de seção.
export function formatDayHeader(date: Date): string {
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
  const day = date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}`
}

// Anúncios: mesmas cores de SALE_CHANNEL_BADGES pra Shopee/Mercado Livre
// (consistência visual -- é a mesma plataforma em telas diferentes).
const MARKETPLACE_PLATFORM_BADGES: Record<MarketplacePlatformKind, StatusBadge> = {
  SHOPEE: { label: 'Shopee', className: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' },
  MERCADO_LIVRE: { label: 'Mercado Livre', className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' },
}

export function getMarketplacePlatformBadge(kind: MarketplacePlatformKind): StatusBadge {
  return MARKETPLACE_PLATFORM_BADGES[kind]
}

const LISTING_STATUS_BADGES: Record<ListingStatus, StatusBadge> = {
  ONLINE: { label: 'Online', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  PAUSADO: { label: 'Pausado', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  RASCUNHO: { label: 'Rascunho', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}

export function getListingStatusBadge(status: ListingStatus): StatusBadge {
  return LISTING_STATUS_BADGES[status]
}

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = { RASCUNHO: 'Rascunho', ONLINE: 'Online', PAUSADO: 'Pausado' }

export const LISTING_FREIGHT_TYPE_LABELS: Record<ListingFreightType, string> = {
  GRATIS_SUBSIDIADO: 'Grátis (subsidiado)',
  PAGO_COMPRADOR: 'Pago pelo comprador',
  PERSONALIZADO: 'Personalizado',
}

export const LISTING_TYPE_LABELS: Record<ListingType, string> = { CLASSICO: 'Clássico', PREMIUM: 'Premium' }

// 5.3: status de estoque (Filamentos/Acessórios/Insumos) virava só
// "emoji + texto", sem o mesmo pill colorido usado em Produção/Pedidos/
// Vendas -- essa função gera o badge equivalente a partir do
// {emoji, label} que getStockStatus/getStockStatusWithThresholds retornam,
// reaproveitando a mesma paleta verde/amarelo/vermelho/cinza.
const STOCK_STATUS_BADGE_CLASSNAMES: Record<string, string> = {
  'Em estoque': 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  'Estoque baixo': 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Estoque crítico': 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  Esgotado: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

export function getStockStatusBadge(status: StockStatus): StatusBadge {
  return { label: `${status.emoji} ${status.label}`, className: STOCK_STATUS_BADGE_CLASSNAMES[status.label] ?? STOCK_STATUS_BADGE_CLASSNAMES.Esgotado }
}

// 2.6 Ajuste de estoque: labels do motivo obrigatório.
export const STOCK_ADJUSTMENT_REASON_LABELS: Record<StockAdjustmentReason, string> = {
  INVENTARIO_FISICO: 'Inventário físico',
  PERDA_DANO: 'Perda por dano',
  PERDA_FALHA_IMPRESSAO: 'Perda por falha de impressão',
  PRODUTO_VENCIDO: 'Produto vencido / inutilizável',
  CORRECAO_CADASTRO: 'Correção de cadastro',
  CONSUMO_NAO_REGISTRADO: 'Consumo não registrado',
  OUTRO: 'Outro',
}

// Human-readable Portuguese labels for WasteReason (prisma/schema.prisma
// §5.4) -- backs the optional wasteReason <select> in ProductionRunForm.
export const WASTE_REASON_LABELS: Record<WasteReason, string> = {
  FALHA_IMPRESSAO: 'Falha de impressão',
  ERRO_CONFIGURACAO: 'Erro de configuração',
  SUPORTE_EXCESSIVO: 'Suporte excessivo',
  QUEBRA: 'Quebra',
  TESTE: 'Teste',
  PURGA: 'Purga',
  TROCA_FILAMENTO: 'Troca de filamento',
  OUTRO: 'Outro',
}
