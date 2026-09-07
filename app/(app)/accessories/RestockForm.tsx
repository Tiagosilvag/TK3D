'use client'
import { useState } from 'react'
import { registerAccessoryPurchase } from '@/actions/accessories'
import { formatCurrency } from '@/lib/format'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// "Repor estoque" (task-3 brief): a compact inline form, one per accessory
// row, that registers a new AccessoryPurchase — recalculating avgUnitCost
// as a weighted average server-side (registerAccessoryPurchase). Same
// live unit-cost preview idea as AccessoryForm's first-purchase preview.
export function RestockForm({ accessoryId }: { accessoryId: string }) {
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  async function action(formData: FormData) {
    const result = await registerAccessoryPurchase(formData)
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
    <form action={action} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="accessoryId" value={accessoryId} />
      <input
        name="quantity"
        type="number"
        step="0.01"
        placeholder="Qtd"
        className="tk-input w-16"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        required
      />
      <input
        name="totalCost"
        type="number"
        step="0.01"
        placeholder="Valor"
        className="tk-input w-20"
        value={totalCost}
        onChange={(e) => setTotalCost(e.target.value)}
        required
      />
      <input name="purchaseDate" type="date" defaultValue={today()} className="tk-input w-36" required />
      <button className="tk-btn-primary px-2 py-1 text-xs" title={Number.isFinite(unitCost) ? `R$/un: ${formatCurrency(unitCost)}` : undefined}>
        Repor
      </button>
    </form>
  )
}
