import { formatCurrency } from '@/lib/format'
import type { PlatformFeeInfo } from './SaleForm'

// Redesign "Vendas" §5: extraído de dentro de SaleForm.tsx (vivia sempre
// visível no rodapé do formulário) -- agora fica atrás do botão "Ver
// taxas cadastradas" (SalesExplorer.tsx), independente do formulário de
// registro estar aberto ou não. Conteúdo/cálculo idênticos a antes, só
// virou um componente próprio.
const PLATFORM_LABELS: Record<string, string> = { SHOPEE: 'Shopee', MERCADO_LIVRE: 'Mercado Livre' }

export function PlatformFeesPanel({ platforms }: { platforms: PlatformFeeInfo[] }) {
  return (
    <div className="tk-panel p-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Taxas cadastradas</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-500 dark:border-slate-700 dark:text-slate-400">Direta: sem taxa</span>
        {platforms.map((p) => (
          <span key={p.kind} className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {PLATFORM_LABELS[p.kind] ?? p.kind}:{' '}
            {p.feeTiers && p.feeTiers.length > 0
              ? p.feeTiers.map((t, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {/* Bug "crash com só 1 faixa": TierEditor (Configurações) permite
                        reduzir até 1 faixa só -- nesse caso ela é a última (maxPrice
                        null) E a primeira (i===0) ao mesmo tempo, sem faixa anterior
                        pra citar em "acima de". */}
                    {t.maxPrice === null ? (i > 0 ? `acima de R$${p.feeTiers![i - 1].maxPrice?.toFixed(2)}` : 'qualquer valor') : `até R$${t.maxPrice.toFixed(2)}`}: {(t.feePercent * 100).toFixed(0)}%+{formatCurrency(t.feeFixed)}
                  </span>
                ))
              : `${(p.feePercent * 100).toFixed(0)}% + ${formatCurrency(p.feeFixed)}`}
          </span>
        ))}
      </div>
    </div>
  )
}
