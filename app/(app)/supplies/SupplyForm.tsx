'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupply, updateSupply } from '@/actions/supplies'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

const SUPPLY_UNITS = [
  { value: 'UN', label: 'Unidade' },
  { value: 'ML', label: 'Mililitro' },
  { value: 'G', label: 'Grama' },
  { value: 'M', label: 'Metro' },
  { value: 'OUTRO', label: 'Outro' },
]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

type EditingSupply = { id: string; name: string; unit: string }

export function SupplyForm({ editingSupply }: { editingSupply?: EditingSupply }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  async function action(formData: FormData) {
    if (editingSupply) {
      const result = await updateSupply(editingSupply.id, formData)
      if (!result.success) {
        alert(result.error)
        return
      }
      router.push('/supplies')
      return
    }
    const result = await createSupply(formData)
    if (result.success) {
      formRef.current?.reset()
      setQuantity('')
      setTotalCost('')
    } else {
      alert(result.error)
    }
  }

  if (editingSupply) {
    return (
      <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
        <label className="text-sm">
          Nome *
          <input name="name" placeholder="Nome" className="tk-input-full" required defaultValue={editingSupply.name} />
        </label>
        <label className="text-sm">
          Unidade *
          <select name="unit" className="tk-input-full" required defaultValue={editingSupply.unit}>
            {SUPPLY_UNITS.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </label>
        <div className="col-span-4 mt-2 flex items-center gap-3">
          <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>
          <Link href="/supplies" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </Link>
        </div>
      </form>
    )
  }

  const qty = parseFloat(quantity)
  const cost = parseFloat(totalCost)
  const hasBoth = quantity !== '' && totalCost !== '' && !isNaN(qty) && !isNaN(cost) && qty > 0 && cost > 0
  const unitCost = hasBoth ? cost / qty : NaN

  return (
    <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
      <label className="text-sm">
        Nome *
        <input name="name" placeholder="Nome" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Unidade *
        <select name="unit" className="tk-input-full" required defaultValue="">
          <option value="" disabled>Unidade</option>
          {SUPPLY_UNITS.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Quantidade (1ª compra) *
        <input name="quantity" type="number" step="0.001" placeholder="Quantidade (1ª compra)" className="tk-input-full" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
      </label>
      <label className="text-sm">
        Valor total pago *
        <input name="totalCost" type="number" step="0.01" placeholder="Valor total pago" className="tk-input-full" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} required />
      </label>

      <label className="text-sm">
        Data da compra *
        <input name="purchaseDate" type="date" defaultValue={today()} className="tk-input-full" required />
      </label>
      <label className="col-span-3 text-sm">
        Observações (opcional)
        <input name="notes" placeholder="Observações (opcional)" className="tk-input-full" />
      </label>

      <div className="col-span-4 mt-2">
        <SubmitButton pendingLabel="Salvando…">Cadastrar insumo</SubmitButton>
      </div>
      <p className="col-span-4 text-xs text-slate-500 dark:text-slate-400">
        Custo unitário resultante: {Number.isFinite(unitCost) ? formatCurrency(unitCost) : '—'}
      </p>
    </form>
  )
}
