'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerSupplyPurchase } from '@/actions/supplies'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// 3.7: "Repor estoque" virou um <dialog> nativo (mesmo padrão do
// AdjustStockButton) em vez de um formulário completo embutido em cada
// linha da tabela -- a tabela ficava larga demais com 3 campos + botão por
// item. Continua registrando uma nova SupplyPurchase, recalculando
// avgUnitCost como média ponderada server-side (registerSupplyPurchase).
export function RestockForm({ supplyId, supplyName, className = 'text-xs text-violet-600 hover:underline dark:text-violet-400' }: { supplyId: string; supplyName: string; className?: string }) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  async function action(formData: FormData) {
    const result = await registerSupplyPurchase(formData)
    if (result.success) {
      dialogRef.current?.close()
      setQuantity('')
      setTotalCost('')
      router.refresh()
    } else {
      alert(result.error)
    }
  }

  const qty = parseFloat(quantity)
  const cost = parseFloat(totalCost)
  const hasBoth = quantity !== '' && totalCost !== '' && !isNaN(qty) && !isNaN(cost) && qty > 0 && cost > 0
  const unitCost = hasBoth ? cost / qty : NaN

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className={className}>
        Repor estoque
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => { setQuantity(''); setTotalCost('') }}
        className="w-80 rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form action={action} className="grid gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Repor estoque</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{supplyName}</p>
          <input type="hidden" name="supplyId" value={supplyId} />
          <label className="text-sm">
            Quantidade *
            <input
              name="quantity"
              type="number"
              step="0.001"
              min="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              className="tk-input-full"
            />
          </label>
          <label className="text-sm">
            Valor total *
            <input
              name="totalCost"
              type="number"
              step="0.01"
              min="0.01"
              value={totalCost}
              onChange={(e) => setTotalCost(e.target.value)}
              required
              className="tk-input-full"
            />
          </label>
          <label className="text-sm">
            Data *
            <input name="purchaseDate" type="date" defaultValue={today()} required className="tk-input-full" />
          </label>
          {Number.isFinite(unitCost) && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Custo por unidade: {formatCurrency(unitCost)}</p>
          )}
          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <SubmitButton pendingLabel="Salvando…">Repor</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
