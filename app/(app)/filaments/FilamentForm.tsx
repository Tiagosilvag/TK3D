'use client'
import { useRef, useState } from 'react'
import { createFilament } from '@/actions/filaments'
import { formatCurrency } from '@/lib/format'

const MATERIALS = [
  { value: 'PLA', label: 'PLA' },
  { value: 'PETG', label: 'PETG' },
  { value: 'TPU', label: 'TPU' },
  { value: 'OUTRO', label: 'Outro' },
]

function formatOrDash(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return formatCurrency(value)
}

export function FilamentForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [spoolWeightKg, setSpoolWeightKg] = useState('')
  const [spoolPrice, setSpoolPrice] = useState('')
  const [colorHex, setColorHex] = useState('#ff0000')

  async function action(formData: FormData) {
    const result = await createFilament(formData)
    if (result.success) {
      formRef.current?.reset()
      setSpoolWeightKg('')
      setSpoolPrice('')
      setColorHex('#ff0000')
    } else {
      alert(result.error)
    }
  }

  const weight = parseFloat(spoolWeightKg)
  const price = parseFloat(spoolPrice)
  const hasWeightAndPrice = spoolWeightKg !== '' && spoolPrice !== '' && !isNaN(weight) && !isNaN(price) && weight > 0 && price > 0
  const pricePerKg = hasWeightAndPrice ? price / weight : NaN
  const pricePerGram = hasWeightAndPrice ? pricePerKg / 1000 : NaN
  const initialStockGrams = hasWeightAndPrice ? weight * 1000 : NaN

  return (
    <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
      <input name="manufacturer" placeholder="Marca/fabricante" className="tk-input" required />
      <select name="material" defaultValue="PLA" className="tk-input" required>
        {MATERIALS.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <input
          name="colorHex"
          type="color"
          value={colorHex}
          onChange={(e) => setColorHex(e.target.value)}
          className="h-9 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-700"
        />
        <input name="colorName" placeholder="Nome da cor" className="tk-input flex-1" required />
      </div>
      <input
        name="spoolWeightKg"
        type="number"
        step="0.001"
        placeholder="Peso do rolo (kg)"
        className="tk-input"
        value={spoolWeightKg}
        onChange={(e) => setSpoolWeightKg(e.target.value)}
        required
      />
      <input
        name="spoolPrice"
        type="number"
        step="0.01"
        placeholder="Preço pago"
        className="tk-input"
        value={spoolPrice}
        onChange={(e) => setSpoolPrice(e.target.value)}
        required
      />
      <button className="col-span-4 mt-2 tk-btn-primary">Adicionar</button>
      <p className="col-span-4 text-xs text-slate-500 dark:text-slate-400">
        R$/kg: {formatOrDash(pricePerKg)} · R$/g: {Number.isFinite(pricePerGram) ? `R$ ${pricePerGram.toFixed(4)}` : '—'} · Estoque inicial: {Number.isFinite(initialStockGrams) ? `${initialStockGrams}g` : '—'}
      </p>
    </form>
  )
}
