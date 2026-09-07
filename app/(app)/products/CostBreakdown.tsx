import type { ProductCostBreakdown } from '@/lib/costing'

function money(value: number): string {
  return `R$ ${value.toFixed(2)}`
}

const ROWS: { key: keyof ProductCostBreakdown; label: string }[] = [
  { key: 'filamentCost', label: 'Filamento' },
  { key: 'electricityCost', label: 'Energia' },
  { key: 'printerCost', label: 'Depreciação da impressora' },
  { key: 'laborCost', label: 'Mão de obra' },
  { key: 'suppliesCost', label: 'Insumos' },
  { key: 'packagingCost', label: 'Embalagem' },
  { key: 'accessoryCost', label: 'Acessório' },
]

export function CostBreakdown({ breakdown }: { breakdown: ProductCostBreakdown }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Custo (ao vivo)</h2>
      <dl className="space-y-1 text-sm">
        {ROWS.map(({ key, label }) => (
          <div key={key} className="flex justify-between text-slate-600">
            <dt>{label}</dt>
            <dd>{money(breakdown[key] as number)}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-slate-200 pt-1 font-medium text-slate-900">
          <dt>Subtotal</dt>
          <dd>{money(breakdown.subtotal)}</dd>
        </div>
        <div className="flex justify-between text-slate-600">
          <dt>Custo final (c/ taxa de falha)</dt>
          <dd>{money(breakdown.finalCost)}</dd>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
          <dt>Preço sugerido</dt>
          <dd>{money(breakdown.suggestedPrice)}</dd>
        </div>
        <div className="flex justify-between font-semibold text-slate-900">
          <dt>Preço marketplace</dt>
          <dd>{money(breakdown.marketplacePrice)}</dd>
        </div>
      </dl>
    </div>
  )
}
