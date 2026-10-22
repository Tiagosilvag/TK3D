'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { undoAssemblies, updateAssemblyQuantity, type RecentAssemblyRow } from '@/actions/assembly'
import { UndoToast } from '@/components/UndoToast'

// Montagens recentes: "Desfazer montagem" devolve peças, acessórios e
// insumos e reconcilia os pedidos (recusa se as unidades já foram
// vendidas ou entregues).
export function RecentAssemblies({ rows }: { rows: RecentAssemblyRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<{ message: string; id: string; previous: number } | null>(null)

  async function applyQuantity(row: RecentAssemblyRow) {
    const next = parseInt(drafts[row.id] ?? '', 10)
    setDrafts((d) => { const { [row.id]: _drop, ...rest } = d; void _drop; return rest })
    if (!Number.isInteger(next) || next === row.quantity) return
    setBusyId(row.id)
    setError(null)
    const result = await updateAssemblyQuantity(row.id, next)
    setBusyId(null)
    if (!result.success) {
      setError(result.error ?? 'Não foi possível alterar a quantidade.')
      return
    }
    setToast({ message: `Quantidade de ${row.productName}: ${row.quantity} → ${next}.`, id: row.id, previous: result.previousQuantity ?? row.quantity })
    router.refresh()
  }

  async function undoQuantity() {
    const t = toast
    setToast(null)
    if (!t) return
    const result = await updateAssemblyQuantity(t.id, t.previous)
    if (!result.success) setError(result.error ?? 'Não foi possível desfazer.')
    router.refresh()
  }

  if (rows.length === 0) return toast ? <UndoToast message={toast.message} onUndo={undoQuantity} onDismiss={() => setToast(null)} durationMs={10000} /> : null

  async function undo(row: RecentAssemblyRow) {
    if (!window.confirm(`Desfazer a montagem de ${row.quantity} × ${row.productName}? Peças, acessórios e insumos voltam ao estoque.`)) return
    setBusyId(row.id)
    setError(null)
    const result = await undoAssemblies([row.id])
    setBusyId(null)
    if (!result.success) setError(result.error ?? 'Não foi possível desfazer.')
    router.refresh()
  }

  return (
    <div className="tk-panel mb-4 p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Montagens recentes</h2>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2 text-left">Data</th>
            <th className="text-left">Produto</th>
            <th className="text-center">Qtd.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="tk-row">
              <td className="py-2 text-slate-500 dark:text-slate-400">{new Date(r.createdAt).toLocaleDateString('pt-BR')}</td>
              <td className="font-medium text-slate-900 dark:text-slate-100">{r.productName}</td>
              <td className="text-center">
                <input
                  type="number"
                  min={1}
                  value={drafts[r.id] ?? String(r.quantity)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void applyQuantity(r) }
                    if (e.key === 'Escape') setDrafts((d) => { const { [r.id]: _drop, ...rest } = d; void _drop; return rest })
                  }}
                  onBlur={() => { if (drafts[r.id] !== undefined) setDrafts((d) => { const { [r.id]: _drop, ...rest } = d; void _drop; return rest }) }}
                  disabled={busyId === r.id}
                  aria-label={`Quantidade montada de ${r.productName}`}
                  className="tk-input-full w-16 text-center"
                />
              </td>
              <td className="text-right">
                <button type="button" disabled={busyId === r.id} onClick={() => undo(r)} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400">
                  Desfazer montagem
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Para corrigir a quantidade, digite e aperte Enter (Esc cancela).</p>
      {toast && <UndoToast message={toast.message} onUndo={undoQuantity} onDismiss={() => setToast(null)} durationMs={10000} />}
    </div>
  )
}
