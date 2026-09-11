'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerPackagingPurchase } from '@/actions/packaging'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

// "Repor estoque" -- mesmo padrão do RestockForm de Acessórios/Insumos,
// sem campo de data (o cadastro/reposição de embalagem não pede data,
// mesma decisão do modal "Nova embalagem").
export function RestockForm({ packagingItemId, packagingItemName }: { packagingItemId: string; packagingItemName: string }) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  async function action(formData: FormData) {
    const result = await registerPackagingPurchase(formData)
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
      <button type="button" onClick={() => dialogRef.current?.showModal()} className="text-xs text-amber-600 hover:underline dark:text-amber-400">
        Repor estoque
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => { setQuantity(''); setTotalCost('') }}
        className="w-80 rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form action={action} className="grid gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Repor estoque</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{packagingItemName}</p>
          <input type="hidden" name="packagingItemId" value={packagingItemId} />
          <label className="text-sm">
            Unidades compradas *
            <input
              name="quantity"
              type="number"
              step="1"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
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
