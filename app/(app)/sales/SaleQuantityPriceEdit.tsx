'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateSaleQuantityPrice } from '@/actions/sales'
import { UndoToast } from '@/components/UndoToast'

// Quantidade e valor unitário direto na linha: digitar e Enter recalcula
// estoque, embalagem, taxa e lucro. Esc volta ao valor salvo. Mostra
// "Desfazer" por 10 s depois de salvar.
export function SaleQuantityPriceEdit({ id, quantity, unitPrice }: { id: string; quantity: number; unitPrice: number }) {
  const router = useRouter()
  const [q, setQ] = useState<string | null>(null)
  const [p, setP] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ previous: { quantity: number; unitPrice: number } } | null>(null)

  const qText = q ?? String(quantity)
  const pText = p ?? unitPrice.toFixed(2).replace('.', ',')

  function reset() {
    setQ(null)
    setP(null)
    setError(null)
  }

  async function save() {
    if (saving || (q === null && p === null)) return
    const newQuantity = parseInt(qText, 10)
    const newPrice = Number(pText.replace(',', '.'))
    if (newQuantity === quantity && Math.abs(newPrice - unitPrice) < 0.005) return reset()
    setSaving(true)
    const result = await updateSaleQuantityPrice(id, newQuantity, newPrice)
    setSaving(false)
    if (!result.success) {
      setError(result.error ?? 'Não foi possível salvar.')
      return
    }
    reset()
    setToast({ previous: result.previous! })
    router.refresh()
  }

  async function undo() {
    const t = toast
    setToast(null)
    if (!t) return
    const result = await updateSaleQuantityPrice(id, t.previous.quantity, t.previous.unitPrice)
    if (!result.success) setError(result.error ?? 'Não foi possível desfazer.')
    router.refresh()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); void save() }
    if (e.key === 'Escape') { e.preventDefault(); reset() }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1.5 text-xs font-normal">
        <input
          value={qText}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void save()}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          aria-label="Quantidade"
          className="tk-input-full w-14 px-1 text-center"
          disabled={saving}
        />
        <span>×</span>
        <input
          value={pText}
          onChange={(e) => setP(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void save()}
          onFocus={(e) => e.target.select()}
          inputMode="decimal"
          aria-label="Valor unitário"
          className="tk-input-full w-20 px-1 text-center"
          disabled={saving}
        />
      </span>
      {error && <span className="max-w-xs text-xs font-normal text-red-600 dark:text-red-400">{error}</span>}
      {toast && <UndoToast message="Venda atualizada." onUndo={undo} onDismiss={() => setToast(null)} durationMs={10000} />}
    </span>
  )
}
