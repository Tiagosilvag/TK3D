'use client'
import { useRef } from 'react'
import { STOCK_ADJUSTMENT_REASON_LABELS } from '@/lib/format'

export interface AdjustmentEntry {
  id: string
  createdAt: string
  difference: number
  reason: string
  reasonNote: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

// Melhoria "Meu Estoque" §11: histórico de ajustes manuais do produto --
// mesmo padrão de AccessoryHistoryButton.tsx, só que sem compras/consumo
// (Produto acabado não tem nenhum dos dois, estoque é derivado das
// tabelas transacionais -- só StockAdjustment tem registro próprio aqui).
export function StockAdjustmentHistoryButton({ productName, adjustments }: { productName: string; adjustments: AdjustmentEntry[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className="text-violet-600 hover:underline dark:text-violet-400">
        Histórico de ajustes
      </button>
      <dialog
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="grid gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Histórico de ajustes — {productName}</h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>

          {adjustments.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum ajuste registrado ainda.</p>
          ) : (
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
          )}

          <div className="mt-1 flex justify-end">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Fechar</button>
          </div>
        </div>
      </dialog>
    </>
  )
}
