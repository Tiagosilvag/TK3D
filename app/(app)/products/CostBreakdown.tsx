import type { ProductCostBreakdown, ProductCostFlags } from '@/lib/costing'
import { formatCurrency } from '@/lib/format'

function money(value: number): string {
  return formatCurrency(value)
}

// Configurações §3: each cost line has a matching Settings.include* flag.
// The breakdown value itself is always shown (transparency, spec §3 —
// "cada linha do breakdown continua sempre calculada e exibida") even when
// its flag is off; the flag only gates whether the row's value visually
// reads as "counted" (contributes to subtotal/finalCost) or "desativado".
const ROWS: { key: keyof ProductCostBreakdown; label: string; flagKey: keyof ProductCostFlags }[] = [
  { key: 'filamentCost', label: 'Filamento', flagKey: 'includeFilamentCost' },
  { key: 'electricityCost', label: 'Energia', flagKey: 'includeEnergyCost' },
  { key: 'printerCost', label: 'Depreciação da impressora', flagKey: 'includeDepreciation' },
  { key: 'maintenanceCost', label: 'Manutenção', flagKey: 'includeMaintenance' },
  { key: 'laborCost', label: 'Mão de obra', flagKey: 'includeLaborCost' },
  { key: 'suppliesCost', label: 'Insumos', flagKey: 'includeSuppliesCost' },
  { key: 'packagingCost', label: 'Embalagem', flagKey: 'includePackagingCost' },
  { key: 'accessoryCost', label: 'Acessórios', flagKey: 'includeAccessoriesCost' },
  // Bug "custo de Mosquetão não calculado": componentProductsCost (custo dos
  // outros PRODUTOS usados como ingrediente, ex.: Mosquetão dentro de
  // Chaveiro Café) já era somado no subtotal (lib/costing.ts#combineProductCost,
  // sob a mesma flag includeAccessoriesCost -- ver comentário lá) mas nunca
  // tinha linha própria aqui, então o valor ficava escondido dentro do
  // subtotal sem nenhuma linha explicando de onde vinha -- parecia "não
  // calculado" mesmo contando de verdade.
  { key: 'componentProductsCost', label: 'Componentes', flagKey: 'includeAccessoriesCost' },
  { key: 'failureRateCost', label: 'Taxa de falha', flagKey: 'includeFailureRate' },
]

// Redesign "Preço por canal" (task-11 brief): pedido explícito "não tire o
// custo ao vivo" -- este painel sempre visível (nunca escondido atrás de
// "ver detalhes") continua existindo exatamente como antes, só perdeu as
// linhas "Preço sugerido"/"Preço marketplace" no rodapé (1 valor genérico
// pros dois marketplaces juntos) -- essas viraram a seção nova
// ChannelPricing.tsx (1 card por canal, ver app/(app)/products/[id]/page.tsx),
// que fica ABAIXO deste painel, nunca no lugar dele.
export function CostBreakdown({ breakdown, flags }: { breakdown: ProductCostBreakdown; flags: ProductCostFlags }) {
  return (
    <div className="tk-panel p-4">
      <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Custo (ao vivo)</h2>
      <dl className="space-y-1 text-sm">
        {ROWS.map(({ key, label, flagKey }) => {
          const enabled = flags[flagKey]
          return (
            <div
              key={key}
              className={enabled ? 'flex justify-between text-slate-600 dark:text-slate-400' : 'flex justify-between text-slate-400 dark:text-slate-600'}
            >
              <dt>
                {label}
                {!enabled && <span className="ml-1 italic">(desativado)</span>}
              </dt>
              <dd>{money(breakdown[key] as number)}</dd>
            </div>
          )
        })}
        <div className="flex justify-between border-t border-slate-200 pt-1 font-medium text-slate-900 dark:border-slate-800 dark:text-slate-100">
          <dt>Subtotal</dt>
          <dd>{money(breakdown.subtotal)}</dd>
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-violet-700 dark:border-slate-800 dark:text-violet-400">
          <dt>Custo final (c/ taxa de falha)</dt>
          <dd>{money(breakdown.finalCost)}</dd>
        </div>
      </dl>
    </div>
  )
}
