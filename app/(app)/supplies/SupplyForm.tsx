'use client'
import { useRef, useState } from 'react'
import { createSupply } from '@/actions/supplies'
import { formatCurrency } from '@/lib/format'

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

// Cadastro de um Supply novo = a primeira compra (task-4 brief, mirroring
// AccessoryForm): este form pede nome+unidade E quantidade+valor total da
// primeira compra na mesma tela, com preview ao vivo do custo unitário
// resultante (totalCost/quantity) enquanto o usuário digita.
export function SupplyForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  async function action(formData: FormData) {
    const result = await createSupply(formData)
    if (result.success) {
      formRef.current?.reset()
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
    <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
      <input name="name" placeholder="Nome" className="tk-input" required />
      <select name="unit" className="tk-input" required defaultValue="">
        <option value="" disabled>Unidade</option>
        {SUPPLY_UNITS.map((u) => (
          <option key={u.value} value={u.value}>{u.label}</option>
        ))}
      </select>
      <input name="quantity" type="number" step="0.001" placeholder="Quantidade (1ª compra)" className="tk-input" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
      <input name="totalCost" type="number" step="0.01" placeholder="Valor total pago" className="tk-input" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} required />

      <input name="purchaseDate" type="date" defaultValue={today()} className="tk-input" required />
      <input name="notes" placeholder="Observações (opcional)" className="tk-input col-span-3" />

      <button className="col-span-4 mt-2 tk-btn-primary">Cadastrar insumo</button>
      <p className="col-span-4 text-xs text-slate-500 dark:text-slate-400">
        Custo unitário resultante: {Number.isFinite(unitCost) ? formatCurrency(unitCost) : '—'}
      </p>
    </form>
  )
}
