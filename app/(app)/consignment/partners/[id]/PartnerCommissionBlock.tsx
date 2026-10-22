'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { payPartnerCommission, deletePartnerPayment } from '@/actions/consignmentPayments'
import { UndoToast } from '@/components/UndoToast'
import { formatCurrency } from '@/lib/format'

// Comissão do parceiro: vendido (bruto), comissão total (Σ das vendas, cada
// uma com a própria %), já pago e a pagar. O campo já vem com o valor total a
// pagar e "✓ Pagar R$ X" quita em 1 clique -- digitar menos paga só parte.
export function PartnerCommissionBlock({
  partnerId,
  grossSold,
  commissionTotal,
  paid,
  due,
  payments,
}: {
  partnerId: string
  grossSold: number
  commissionTotal: number
  paid: number
  due: number
  payments: { id: string; amount: number; paidAt: string }[]
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; paymentId: string } | null>(null)

  const value = draft ?? due.toFixed(2).replace('.', ',')
  const amount = Number(value.replace(',', '.'))
  const valid = Number.isFinite(amount) && amount > 0 && amount <= due + 0.001

  async function pay() {
    if (busy || !valid) return
    setBusy(true)
    setError(null)
    const result = await payPartnerCommission(partnerId, amount)
    setBusy(false)
    if (!result.success) return setError(result.error ?? 'Não foi possível registrar o pagamento.')
    setDraft(null)
    setToast({ message: `Pagamento de ${formatCurrency(amount)} registrado.`, paymentId: result.paymentId! })
    router.refresh()
  }

  async function undo() {
    const t = toast
    setToast(null)
    if (!t) return
    await deletePartnerPayment(t.paymentId)
    router.refresh()
  }

  async function remove(id: string) {
    await deletePartnerPayment(id)
    router.refresh()
  }

  return (
    <div className="tk-panel p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Comissão</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Vendido (bruto)</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(grossSold)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Comissão total</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(commissionTotal)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Já pago</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(paid)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">A pagar</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(due)}</p>
        </div>
      </div>

      {due > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Valor do pagamento (R$)
            <input
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void pay() } }}
              onFocus={(e) => e.target.select()}
              inputMode="decimal"
              className="tk-input-full mt-1 w-36"
            />
          </label>
          <button type="button" disabled={busy || !valid} onClick={() => void pay()} className="tk-btn-primary px-4 py-2 text-sm disabled:opacity-50">
            ✓ Pagar {formatCurrency(valid ? amount : due)}
          </button>
          <span className="pb-2 text-xs text-slate-400 dark:text-slate-500">Digite um valor menor para pagar só parte.</span>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {payments.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm dark:divide-slate-800 dark:border-slate-800">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-1.5">
              <span className="text-slate-500 dark:text-slate-400">{new Date(p.paidAt).toLocaleDateString('pt-BR')}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(p.amount)}</span>
                <button type="button" onClick={() => void remove(p.id)} aria-label="Excluir pagamento" className="text-slate-400 hover:text-red-600">✕</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {toast && <UndoToast message={toast.message} onUndo={undo} onDismiss={() => setToast(null)} durationMs={10000} />}
    </div>
  )
}
