'use client'
import { useRef, useState } from 'react'
import { createAccessory } from '@/actions/accessories'
import { formatCurrency } from '@/lib/format'

const ACCESSORY_TYPES = [
  { value: 'CORRENTE_BOLINHA', label: 'Corrente bolinha' },
  { value: 'CORRENTE_ELO', label: 'Corrente elo' },
  { value: 'MOSQUETAO', label: 'Mosquetão' },
  { value: 'CLICKER', label: 'Clicker' },
  { value: 'OUTRO', label: 'Outro' },
]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// Cadastro de um Accessory novo = a primeira compra (task-3 brief): este
// form pede nome+tipo+cor (opcional) E quantidade+valor total da primeira
// compra na mesma tela, com preview ao vivo do custo unitário resultante
// (totalCost/quantity) enquanto o usuário digita.
export function AccessoryForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [hasColor, setHasColor] = useState(false)
  const [colorHex, setColorHex] = useState('#ff0000')
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  async function action(formData: FormData) {
    const result = await createAccessory(formData)
    if (result.success) {
      formRef.current?.reset()
      setHasColor(false)
      setColorHex('#ff0000')
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
      <select name="type" className="tk-input" required defaultValue="">
        <option value="" disabled>Tipo</option>
        {ACCESSORY_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      <input name="quantity" type="number" step="0.01" placeholder="Quantidade (1ª compra)" className="tk-input" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
      <input name="totalCost" type="number" step="0.01" placeholder="Valor total pago" className="tk-input" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} required />

      <label className="col-span-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
        <input type="checkbox" checked={hasColor} onChange={(e) => setHasColor(e.target.checked)} className="rounded border" />
        Este acessório tem uma cor específica
      </label>
      {hasColor && (
        <div className="col-span-4 flex items-center gap-2">
          <input
            name="colorHex"
            type="color"
            value={colorHex}
            onChange={(e) => setColorHex(e.target.value)}
            className="h-9 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-700"
          />
          <input name="colorName" placeholder="Nome da cor" className="tk-input flex-1" required />
        </div>
      )}

      <input name="purchaseDate" type="date" defaultValue={today()} className="tk-input" required />
      <input name="notes" placeholder="Observações (opcional)" className="tk-input col-span-3" />

      <button className="col-span-4 mt-2 tk-btn-primary">Cadastrar acessório</button>
      <p className="col-span-4 text-xs text-slate-500 dark:text-slate-400">
        Custo unitário resultante: {Number.isFinite(unitCost) ? formatCurrency(unitCost) : '—'}
      </p>
    </form>
  )
}
