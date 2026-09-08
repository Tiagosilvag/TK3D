import type { ProductionStatus, WasteReason, SupplyUnit, OrderStatus, OrderChannel, StockAdjustmentReason } from '@prisma/client'

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

// Sufixo de unidade de medida usado no "Custo por unidade" de Insumos (ex.:
// "R$ 25,55/g", "R$ 0,12/ml", "R$ 3,40/m").
const SUPPLY_UNIT_SUFFIX: Record<SupplyUnit, string> = { UN: 'un', ML: 'ml', G: 'g', M: 'm', OUTRO: 'un' }

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
// getProductionStatusBadge) e labels de canal.
const ORDER_STATUS_BADGES: Record<OrderStatus, StatusBadge> = {
  RECEBIDO: { label: 'Recebido', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  EM_PRODUCAO: { label: 'Em produção', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  PRONTO: { label: 'Pronto', className: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' },
  DESPACHADO: { label: 'Despachado', className: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' },
  CONCLUIDO: { label: 'Concluído', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
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
}

export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  DIRETA: 'Direta',
  SHOPEE: 'Shopee',
  MERCADO_LIVRE: 'Mercado Livre',
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
