'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import type { PartnerLedger, LedgerVariantRef } from '@/lib/reports'
import { editPartnerLedger, restorePartnerLedger, type LedgerOp, type LedgerSnapshot } from '@/actions/consignmentLedger'
import { VariacaoPecas } from '@/components/VariacaoPecas'
import { UndoToast } from '@/components/UndoToast'

type Tab = 'deliveries' | 'sales' | 'returns' | 'payments'
const TABS: { key: Tab; label: string }[] = [
  { key: 'deliveries', label: 'Entregas' },
  { key: 'sales', label: 'Vendas' },
  { key: 'returns', label: 'Devoluções' },
  { key: 'payments', label: 'Pagamentos' },
]

const brDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—')
const toNumber = (s: string) => Number(s.replace(',', '.'))

// Campo que grava ao sair do campo ou com Enter, só se o valor mudou.
function EditField({ value, onCommit, width = 'w-16', ariaLabel, disabled }: { value: string; onCommit: (v: string) => void; width?: string; ariaLabel: string; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  function commit() {
    if (draft === null) return
    const next = draft
    setDraft(null)
    if (next.trim() !== value) onCommit(next.trim())
  }
  return (
    <input
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') setDraft(null) }}
      onFocus={(e) => e.target.select()}
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      className={`tk-input-full ${width} text-center`}
    />
  )
}

function DateField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return (
    <input type="date" value={value.slice(0, 10)} onChange={(e) => e.target.value && e.target.value !== value.slice(0, 10) && onCommit(e.target.value)} aria-label="Data" className="tk-input-full w-36 text-xs" />
  )
}

function Variant({ v }: { v: LedgerVariantRef }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{v.productName}</p>
      {v.attrs.length > 0 ? <VariacaoPecas attrs={v.attrs} /> : v.label ? <p className="text-xs text-slate-500 dark:text-slate-400">{v.label}</p> : null}
    </div>
  )
}

export function PartnerMovements({ partnerId, ledger, payments }: { partnerId: string; ledger: PartnerLedger; payments: { id: string; amount: number; paidAt: string }[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('deliveries')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; snapshot: LedgerSnapshot } | null>(null)

  async function apply(op: LedgerOp, message: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await editPartnerLedger(partnerId, op)
    setBusy(false)
    if (!result.success) return setError(result.error ?? 'Não foi possível salvar.')
    if (result.snapshot) setToast({ message, snapshot: result.snapshot })
    router.refresh()
  }

  async function undo() {
    const t = toast
    setToast(null)
    if (!t) return
    const result = await restorePartnerLedger(partnerId, t.snapshot)
    if (!result.success) setError(result.error ?? 'Não foi possível desfazer.')
    router.refresh()
  }

  const counts: Record<Tab, number> = { deliveries: ledger.deliveries.length, sales: ledger.sales.length, returns: ledger.returns.length, payments: payments.length }

  return (
    <div className="tk-panel p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Movimentos</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500">Corrija quantidade, preço, comissão ou data digitando e apertando Enter. Se a conta deixar de fechar, a mudança é recusada.</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
            {t.label} {counts[t.key]}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <div className="mt-3 space-y-3">
        {tab === 'deliveries' && ledger.deliveries.map((b) => (
          <div key={b.batchId} className="rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
              <DateField value={b.date} onCommit={(date) => void apply({ type: 'deliveryDate', batchId: b.batchId, date }, 'Data da entrega corrigida.')} />
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{b.items.reduce((s, i) => s + i.quantity, 0)} peças · {formatCurrency(b.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0))}</span>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {b.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <Variant v={i} />
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span className="tabular-nums">vendeu {i.sold} · devolveu {i.returned}</span>
                    <label className="flex items-center gap-1">Qtd.<EditField ariaLabel="Quantidade" value={String(i.quantity)} width="w-14" onCommit={(v) => void apply({ type: 'delivery', id: i.id, quantity: Math.floor(toNumber(v)) }, 'Entrega corrigida.')} /></label>
                    <label className="flex items-center gap-1">R$<EditField ariaLabel="Preço unitário" value={i.unitPrice.toFixed(2).replace('.', ',')} width="w-20" onCommit={(v) => void apply({ type: 'delivery', id: i.id, unitPrice: toNumber(v) }, 'Preço da entrega corrigido.')} /></label>
                    <button type="button" aria-label="Remover item" disabled={busy} onClick={() => void apply({ type: 'delivery', id: i.id, quantity: 0 }, 'Item da entrega removido.')} className="text-slate-400 hover:text-red-600 disabled:opacity-40">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {tab === 'sales' && ledger.sales.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <DateField value={s.date} onCommit={(date) => void apply({ type: 'sale', id: s.id, date }, 'Data da venda corrigida.')} />
              <Variant v={s} />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <label className="flex items-center gap-1">Qtd.<EditField ariaLabel="Quantidade" value={String(s.quantity)} width="w-14" onCommit={(v) => void apply({ type: 'sale', id: s.id, quantity: Math.floor(toNumber(v)) }, 'Venda corrigida.')} /></label>
              <label className="flex items-center gap-1">R$<EditField ariaLabel="Preço unitário" value={s.unitPrice.toFixed(2).replace('.', ',')} width="w-20" onCommit={(v) => void apply({ type: 'sale', id: s.id, unitPrice: toNumber(v) }, 'Preço da venda corrigido.')} /></label>
              <label className="flex items-center gap-1">Comissão %<EditField ariaLabel="Comissão" value={String(Math.round(s.commissionPercent * 10000) / 100).replace('.', ',')} width="w-14" onCommit={(v) => void apply({ type: 'sale', id: s.id, commissionPercent: toNumber(v) / 100 }, 'Comissão corrigida.')} /></label>
              <button type="button" aria-label="Excluir venda" disabled={busy} onClick={() => void apply({ type: 'sale', id: s.id, quantity: 0 }, 'Venda excluída.')} className="text-slate-400 hover:text-red-600 disabled:opacity-40">✕</button>
            </div>
          </div>
        ))}

        {tab === 'returns' && ledger.returns.map((r) => (
          <div key={r.deliveryId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <span className="w-24 text-xs text-slate-500 dark:text-slate-400">{brDate(r.date)}</span>
              <Variant v={r} />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <label className="flex items-center gap-1">Qtd.<EditField ariaLabel="Quantidade devolvida" value={String(r.quantity)} width="w-14" onCommit={(v) => void apply({ type: 'return', deliveryId: r.deliveryId, quantity: Math.floor(toNumber(v)) }, 'Devolução corrigida.')} /></label>
              <button type="button" aria-label="Excluir devolução" disabled={busy} onClick={() => void apply({ type: 'return', deliveryId: r.deliveryId, quantity: 0 }, 'Devolução excluída.')} className="text-slate-400 hover:text-red-600 disabled:opacity-40">✕</button>
            </div>
          </div>
        ))}

        {tab === 'payments' && payments.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <DateField value={p.paidAt} onCommit={(date) => void apply({ type: 'payment', id: p.id, date }, 'Data do pagamento corrigida.')} />
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <label className="flex items-center gap-1">R$<EditField ariaLabel="Valor do pagamento" value={p.amount.toFixed(2).replace('.', ',')} width="w-24" onCommit={(v) => void apply({ type: 'payment', id: p.id, amount: toNumber(v) }, 'Pagamento corrigido.')} /></label>
              <button type="button" aria-label="Excluir pagamento" disabled={busy} onClick={() => void apply({ type: 'payment', id: p.id, amount: 0 }, 'Pagamento excluído.')} className="text-slate-400 hover:text-red-600 disabled:opacity-40">✕</button>
            </div>
          </div>
        ))}

        {counts[tab] === 0 && <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Nada registrado aqui ainda.</p>}
      </div>

      {toast && <UndoToast message={toast.message} onUndo={undo} onDismiss={() => setToast(null)} durationMs={10000} />}
    </div>
  )
}
