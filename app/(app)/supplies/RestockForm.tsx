'use client'
import { useState } from 'react'
import { registerSupplyPurchase } from '@/actions/supplies'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// "Repor estoque" (task-4 brief, mirroring Accessory's RestockForm): a
// compact inline form, one per supply row, that registers a new
// SupplyPurchase — recalculating avgUnitCost as a weighted average
// server-side (registerSupplyPurchase). Same live unit-cost preview idea
// as SupplyForm's first-purchase preview.
export function RestockForm({ supplyId }: { supplyId: string }) {
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  async function action(formData: FormData) {
    const result = await registerSupplyPurchase(formData)
    if (result.success) {
      setQuantity('')
      setTotalCost('')
    } else {
      alert(result.error)
    }
  }

  const qty = parseFloat(quantity)
  const cost = parseFloat(totalCost)
  const hasBoth = quantity !== '' && totalCost !== '' && !isNaN(qty) && !isNaN(cost) && qty > 0 && cost > 0
  const unitCost = hasBoth ? cost / qty : NaN

  return (
    <form action={action} className="flex flex-wrap items-end gap-1">
      <input type="hidden" name="supplyId" value={supplyId} />
      <label className="text-xs text-slate-500 dark:text-slate-400">
        Qtd *
        <input
          name="quantity"
          type="number"
          step="0.001"
          placeholder="Qtd"
          className="tk-input mt-0.5 w-16"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
      </label>
      <label className="text-xs text-slate-500 dark:text-slate-400">
        Valor *
        <input
          name="totalCost"
          type="number"
          step="0.01"
          placeholder="Valor"
          className="tk-input mt-0.5 w-20"
          value={totalCost}
          onChange={(e) => setTotalCost(e.target.value)}
          required
        />
      </label>
      <label className="text-xs text-slate-500 dark:text-slate-400">
        Data *
        <input name="purchaseDate" type="date" defaultValue={today()} className="tk-input mt-0.5 w-36" required />
      </label>
      <SubmitButton pendingLabel="…" className="tk-btn-primary px-2 py-1 text-xs">
        <span title={Number.isFinite(unitCost) ? `R$/un: ${formatCurrency(unitCost)}` : undefined}>Repor</span>
      </SubmitButton>
    </form>
  )
}
