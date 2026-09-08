'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmAssembly } from '@/actions/assembly'
import { SubmitButton } from '@/components/SubmitButton'

export function ConfirmAssemblyForm({ productId, maxAssemblableUnits }: { productId: string; maxAssemblableUnits: number }) {
  const router = useRouter()
  const [quantity, setQuantity] = useState(maxAssemblableUnits > 0 ? '1' : '0')

  async function action(formData: FormData) {
    const result = await confirmAssembly(formData)
    if (result.success) {
      router.refresh()
    } else {
      alert(result.error)
    }
  }

  return (
    <form action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4">
      <input type="hidden" name="productId" value={productId} />
      <label className="text-sm">
        Quantidade a montar *
        <input
          name="quantity"
          type="number"
          step="1"
          min="1"
          max={maxAssemblableUnits}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="tk-input-full"
          required
          disabled={maxAssemblableUnits <= 0}
        />
      </label>
      <label className="col-span-full text-sm md:col-span-2">
        Observações (opcional)
        <input name="notes" className="tk-input-full" />
      </label>
      <div className="col-span-full mt-2">
        <SubmitButton pendingLabel="Montando…" disabled={maxAssemblableUnits <= 0}>
          Confirmar montagem
        </SubmitButton>
      </div>
    </form>
  )
}
