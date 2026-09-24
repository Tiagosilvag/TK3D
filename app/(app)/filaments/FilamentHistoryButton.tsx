'use client'
import { useRef } from 'react'
import { formatCurrency, STOCK_ADJUSTMENT_REASON_LABELS } from '@/lib/format'

export interface FilamentPurchaseEntry {
  id: string
  purchaseDate: string
  weightGrams: number
  totalCost: number
}

export interface FilamentAdjustmentEntry {
  id: string
  createdAt: string
  difference: number
  reason: string
  reasonNote: string | null
}

export interface FilamentConsumptionEntry {
  id: string
  date: string
  productName: string
  partName: string | null
  gramsUsed: number
  gramsWasted: number
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

// Bug "perde histórico de consumo quando o filamento esgota": até aqui, o
// histórico de consumo só vivia numa linha expansível dentro da tabela de
// filamentos EM ESTOQUE (FilamentsExplorer) -- um filamento esgotado saía
// dessa tabela (vai pra seção "Filamentos esgotados", só com "Remover") e
// levava o histórico junto, mesmo o dado continuando intacto no banco
// (ProductionRun nunca é apagado). Melhoria "Filamentos" (pedido do
// usuário): histórico vira um modal acessível pelo menu de ações (⋯) --
// mesmo padrão de AccessoryHistoryButton -- disponível tanto pra
// filamentos em estoque quanto esgotados, já que os dois recebem esse
// botão agora (ver FilamentsExplorer/page.tsx).
export function FilamentHistoryButton({
  filamentName,
  purchases,
  adjustments,
  consumptionHistory,
  className = 'tk-menu-item',
}: {
  filamentName: string
  purchases: FilamentPurchaseEntry[]
  adjustments: FilamentAdjustmentEntry[]
  consumptionHistory: FilamentConsumptionEntry[]
  className?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const total = purchases.length + adjustments.length + consumptionHistory.length

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className={className}>
        Histórico ({total})
      </button>
      <dialog
        ref={dialogRef}
        className="w-full [--tk-dialog-cap:32rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="grid grid-cols-1 gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Histórico — {filamentName}</h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              ✕
            </button>
          </div>

          {purchases.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Compras</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="tk-table-head-row">
                    <th className="pr-2">Data</th>
                    <th className="pr-2">Peso</th>
                    <th className="pr-2">Valor total</th>
                    <th>R$/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id} className="tk-row">
                      <td className="pr-2">{formatDate(p.purchaseDate)}</td>
                      <td className="pr-2">+{p.weightGrams}g</td>
                      <td className="pr-2">{formatCurrency(p.totalCost)}</td>
                      <td>{formatCurrency((p.totalCost / p.weightGrams) * 1000)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {adjustments.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Ajustes</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="tk-table-head-row">
                    <th className="pr-2">Data</th>
                    <th className="pr-2">Ajuste</th>
                    <th className="pr-2">Motivo</th>
                    <th>Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((adj) => (
                    <tr key={adj.id} className="tk-row">
                      <td className="pr-2">{formatDate(adj.createdAt)}</td>
                      <td className="pr-2">{adj.difference > 0 ? '+' : ''}{adj.difference}g</td>
                      <td className="pr-2">{STOCK_ADJUSTMENT_REASON_LABELS[adj.reason as keyof typeof STOCK_ADJUSTMENT_REASON_LABELS]}</td>
                      <td>{adj.reasonNote ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {consumptionHistory.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Consumo</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="tk-table-head-row">
                    <th className="pr-2">Data</th>
                    <th className="pr-2">Produto</th>
                    <th className="pr-2">Usado</th>
                    <th>Desperdiçado</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptionHistory.map((h) => (
                    <tr key={h.id} className="tk-row">
                      <td className="pr-2">{formatDate(h.date)}</td>
                      <td className="pr-2">{h.productName}{h.partName ? ` — ${h.partName}` : ''}</td>
                      <td className="pr-2">-{h.gramsUsed}g</td>
                      <td>{h.gramsWasted}g</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum registro ainda.</p>}

          <div className="mt-1 flex justify-end">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Fechar
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
