import type { ProductCostBreakdown } from '@/lib/costing'
import { formatCurrency } from '@/lib/format'

function money(value: number): string {
  return formatCurrency(value)
}

const ROWS: { key: keyof ProductCostBreakdown; label: string }[] = [
  { key: 'filamentCost', label: 'Filamento' },
  { key: 'electricityCost', label: 'Energia' },
  { key: 'printerCost', label: 'Depreciação da impressora' },
  { key: 'maintenanceCost', label: 'Manutenção' },
  { key: 'laborCost', label: 'Mão de obra' },
  { key: 'suppliesCost', label: 'Insumos' },
  { key: 'packagingCost', label: 'Embalagem' },
  { key: 'accessoryCost', label: 'Acessórios' },
]

export function CostBreakdown({ breakdown }: { breakdown: ProductCostBreakdown }) {
  return (
    <div className="tk-panel p-4">
      <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Custo (ao vivo)</h2>
      <dl className="space-y-1 text-sm">
        {ROWS.map(({ key, label }) => (
          <div key={key} className="flex justify-between text-slate-600 dark:text-slate-400">
            <dt>{label}</dt>
            <dd>{money(breakdown[key] as number)}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-slate-200 pt-1 font-medium text-slate-900 dark:border-slate-800 dark:text-slate-100">
          <dt>Subtotal</dt>
          <dd>{money(breakdown.subtotal)}</dd>
        </div>
        <div className="flex justify-between text-slate-600 dark:text-slate-400">
          <dt>Custo final (c/ taxa de falha)</dt>
          <dd>{money(breakdown.finalCost)}</dd>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-amber-700 dark:border-slate-800 dark:text-amber-400">
          <dt>Preço sugerido</dt>
          <dd>{money(breakdown.suggestedPrice)}</dd>
        </div>
        <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-400">
          <dt>Preço marketplace</dt>
          <dd>{money(breakdown.marketplacePrice)}</dd>
        </div>
      </dl>
    </div>
  )
}
