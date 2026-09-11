'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addProductSupplyUsage } from '@/actions/products'
import { SUPPLY_UNIT_SUFFIX } from '@/lib/format'
import type { SupplyUnit } from '@prisma/client'

export interface SupplyUsageOption {
  id: string
  name: string
  unit: SupplyUnit
  defaultUsage: number | null
}

// Melhoria "Insumos": ao escolher o insumo, a quantidade já vem
// pré-preenchida com o "Uso padrão" cadastrado nele (Supply.defaultUsage) --
// continua totalmente editável depois, só poupa digitar do zero toda vez
// que o mesmo insumo (ex.: 1ml de cola) é adicionado numa ficha técnica
// nova. Sem uso padrão cadastrado, o campo fica vazio como já era.
export function AddSupplyUsageForm({ productId, supplies }: { productId: string; supplies: SupplyUsageOption[] }) {
  const router = useRouter()
  const [supplyId, setSupplyId] = useState('')
  const [quantity, setQuantity] = useState('')

  const selected = supplies.find((s) => s.id === supplyId)

  function handleSupplyChange(id: string) {
    setSupplyId(id)
    const supply = supplies.find((s) => s.id === id)
    setQuantity(supply?.defaultUsage != null ? String(supply.defaultUsage) : '')
  }

  async function action(formData: FormData) {
    const result = await addProductSupplyUsage(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    setSupplyId('')
    setQuantity('')
    router.refresh()
  }

  return (
    <form action={action} className="mt-4 grid grid-cols-3 gap-2">
      <input type="hidden" name="productId" value={productId} />
      <select
        name="supplyId"
        className="tk-input"
        required
        value={supplyId}
        onChange={(e) => handleSupplyChange(e.target.value)}
      >
        <option value="" disabled>Selecione um insumo</option>
        {supplies.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <label className="text-sm">
        <div className="flex items-center gap-1">
          <input
            name="quantity"
            type="number"
            step="0.001"
            min="0.001"
            placeholder="Quantidade"
            className="tk-input"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
          {selected && <span className="text-slate-400 dark:text-slate-500">{SUPPLY_UNIT_SUFFIX[selected.unit]}</span>}
        </div>
      </label>
      <button className="tk-btn-primary">Adicionar</button>
    </form>
  )
}
