'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerFilamentPurchase } from '@/actions/filaments'
import { formatCurrency } from '@/lib/format'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { SubmitButton } from '@/components/SubmitButton'

// Melhoria "Estoque de filamento por custo médio ponderado": "Repor
// estoque" de uma cor já cadastrada vira um <dialog> próprio (mesmo padrão
// de accessories/RestockForm.tsx) -- registra uma nova FilamentPurchase,
// soma weightGrams no currentStockGrams existente e recalcula
// avgUnitCostPerGram como média ponderada server-side
// (registerFilamentPurchase). Comprar a mesma cor de novo, mesmo que a
// preço diferente, nunca mais cria um "Rolo #002" -- soma na mesma linha.
export function RestockForm({ filamentId, filamentName, className = 'text-xs text-violet-600 hover:underline dark:text-violet-400' }: { filamentId: string; filamentName: string; className?: string }) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [weightKg, setWeightKg] = useState('')
  const [totalCost, setTotalCost] = useState('')

  async function action(formData: FormData) {
    const result = await registerFilamentPurchase(formData)
    if (result.success) {
      dialogRef.current?.close()
      setWeightKg('')
      setTotalCost('')
      router.refresh()
    } else {
      alert(result.error)
    }
  }

  const weight = parseFloat(weightKg)
  const cost = parseFloat(totalCost)
  const hasBoth = weightKg !== '' && totalCost !== '' && !isNaN(weight) && !isNaN(cost) && weight > 0 && cost > 0
  const pricePerKg = hasBoth ? cost / weight : NaN

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className={className}>
        Repor estoque
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => { setWeightKg(''); setTotalCost('') }}
        className="w-80 rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form action={action} className="grid grid-cols-1 gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Repor estoque</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{filamentName}</p>
          <input type="hidden" name="filamentId" value={filamentId} />
          <label className="text-sm">
            Peso comprado (kg) *
            <input
              name="weightKg"
              type="number"
              step="0.001"
              min="0.001"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              required
              className="tk-input-full"
            />
          </label>
          <label className="text-sm">
            Valor total pago *
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
          <label className="text-sm">
            Observações (opcional)
            <input name="notes" className="tk-input-full" />
          </label>
          {Number.isFinite(pricePerKg) && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Custo por kg desta compra: {formatCurrency(pricePerKg)}</p>
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
