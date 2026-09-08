import type { ProductionStatus, WasteReason } from '@prisma/client'

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
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
