import { formatCurrency } from '@/lib/format'
import type { ConsignmentPartnerDetail } from '@/lib/reports'

// Melhoria "Resultado das vendas": a tela só mostrava quantidades (itens
// com ela/total vendido/comissão a pagar), sem o resultado financeiro em si
// -- este par de cards substitui os 3 painéis antigos, mostrando a conta
// completa (Vendido − Comissão − Custo = Meu lucro) pro que já foi vendido
// e a projeção (preço de venda/custo parado/lucro se vender tudo) pro que
// ainda está com o parceiro. Todos os números já vêm prontos de
// getConsignmentPartnerDetail (lib/reports.ts) -- este componente só
// formata/exibe, nenhuma conta refeita aqui.
function percentOf(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (part / total) * 100))
}

export function PartnerFinancialSummary({
  detail,
  productsWithStock,
}: {
  detail: ConsignmentPartnerDetail
  productsWithStock: number
}) {
  const { soldValue, soldCommission, soldCost, soldProfit, remainingValue, remainingCost, remainingProfitPotential, itemsWithPartner, totalSold, defaultCommissionPercent } = detail

  const costShare = percentOf(soldCost, soldValue)
  const commissionShare = percentOf(soldCommission, soldValue)
  const profitShare = percentOf(soldProfit, soldValue)
  const profitPercent = soldValue > 0 ? (soldProfit / soldValue) * 100 : 0

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="tk-panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Resultado das vendas</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">{totalSold} peças vendidas até hoje</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Vendido</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(soldValue)}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">soma das peças × preço de venda</p>
          </div>
          <div>
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Comissão · {(defaultCommissionPercent * 100).toFixed(0)}%</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(soldCommission)}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">a pagar para {detail.partnerName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-red-500 dark:text-red-400">Custo de produção</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(soldCost)}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">o que gastei nas peças vendidas</p>
          </div>
          <div>
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Meu lucro</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(soldProfit)}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{profitPercent.toFixed(1)}% do que foi vendido</p>
          </div>
        </div>

        <div className="mt-4 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          {soldValue > 0 ? (
            <>
              <div className="h-full bg-red-400" style={{ width: `${costShare}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${commissionShare}%` }} />
              <div className="h-full bg-emerald-500" style={{ width: `${profitShare}%` }} />
            </>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 dark:text-slate-500">
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" /> Custo {costShare.toFixed(1)}%</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Comissão {commissionShare.toFixed(1)}%</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Lucro {profitShare.toFixed(1)}%</span>
          </span>
          <span>de cada R$ 100 vendidos, R$ {profitShare.toFixed(0)} ficam comigo</span>
        </div>
      </div>

      <div className="tk-panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Parado com ela</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">ainda não vendido</p>
        </div>

        <p className="mt-3 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {itemsWithPartner} <span className="text-sm font-normal text-slate-400 dark:text-slate-500">peças · {productsWithStock} produtos</span>
        </p>

        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Valor a preço de venda</span>
            <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(remainingValue)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Custo que tenho parado</span>
            <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(remainingCost)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">Lucro se vender tudo</span>
            <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(remainingProfitPotential)}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Já descontando a comissão de {(defaultCommissionPercent * 100).toFixed(0)}% de {detail.partnerName}.</p>
      </div>
    </div>
  )
}
