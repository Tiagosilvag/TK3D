// Extraído de components/QuickCostCalculatorDrawer.tsx (onde vivia como
// função privada `chipClass`) pra reaproveitar no redesign de Pedidos
// sem duplicar o mesmo par de classes gradiente/outline -- QuickCostCalculatorDrawer.tsx
// também passou a importar daqui.
export function chipClass(active: boolean): string {
  return `rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
  }`
}
