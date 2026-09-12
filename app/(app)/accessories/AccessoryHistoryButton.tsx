'use client'
import { useRef } from 'react'
import { formatCurrency, STOCK_ADJUSTMENT_REASON_LABELS } from '@/lib/format'

const CONSUMPTION_SOURCE_LABELS = { ASSEMBLY: 'Montagem', SALE: 'Venda' } as const

export interface PurchaseEntry {
  id: string
  purchaseDate: string
  quantity: number
  totalCost: number
}

export interface AdjustmentEntry {
  id: string
  createdAt: string
  difference: number
  reason: string
  reasonNote: string | null
}

export interface ConsumptionEntry {
  id: string
  consumedAt: string
  quantity: number
  productName: string
  source: 'ASSEMBLY' | 'SALE'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

// Melhoria "Acessórios" §4: "Histórico" deixa de ser uma linha expansível
// fixa na tabela e vira um item do menu de ações (⋯), abrindo num
// &lt;dialog&gt; -- mesmo padrão de RestockForm/AdjustStockButton (botão de
// texto que abre um modal próprio), reduzindo colunas da tabela.
export function AccessoryHistoryButton({
  accessoryName,
  purchases,
  adjustments,
  consumptionHistory,
}: {
  accessoryName: string
  purchases: PurchaseEntry[]
  adjustments: AdjustmentEntry[]
  consumptionHistory: ConsumptionEntry[]
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const total = purchases.length + adjustments.length + consumptionHistory.length

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className="tk-menu-item">
        Histórico ({total})
      </button>
      <dialog
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="grid gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Histórico — {accessoryName}</h3>
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
                    <th className="pr-2">Qtd</th>
                    <th className="pr-2">Valor total</th>
                    <th>R$/un</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id} className="tk-row">
                      <td className="pr-2">{formatDate(p.purchaseDate)}</td>
                      <td className="pr-2">+{p.quantity}</td>
                      <td className="pr-2">{formatCurrency(p.totalCost)}</td>
                      <td>{formatCurrency(p.totalCost / p.quantity)}</td>
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
                      <td className="pr-2">{adj.difference > 0 ? '+' : ''}{adj.difference}</td>
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
                    <th className="pr-2">Consumido</th>
                    <th className="pr-2">Produto</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptionHistory.map((c) => (
                    <tr key={c.id} className="tk-row">
                      <td className="pr-2">{formatDate(c.consumedAt)}</td>
                      <td className="pr-2">-{c.quantity}</td>
                      <td className="pr-2">{c.productName}</td>
                      <td>{CONSUMPTION_SOURCE_LABELS[c.source]}</td>
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
