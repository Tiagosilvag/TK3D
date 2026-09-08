'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createFilament, updateFilament } from '@/actions/filaments'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

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

type EditingFilament = {
  id: string
  manufacturer: string
  material: string
  colorName: string
  colorHex: string
  spoolWeightKg: number
  spoolPrice: number
}

export function FilamentForm({ editingFilament }: { editingFilament?: EditingFilament }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [spoolWeightKg, setSpoolWeightKg] = useState(editingFilament ? String(editingFilament.spoolWeightKg) : '')
  const [spoolPrice, setSpoolPrice] = useState(editingFilament ? String(editingFilament.spoolPrice) : '')
  const [colorHex, setColorHex] = useState(editingFilament?.colorHex ?? '#ff0000')

  async function action(formData: FormData) {
    const result = editingFilament
      ? await updateFilament(editingFilament.id, formData)
      : await createFilament(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    if (editingFilament) {
      router.push('/filaments')
      return
    }
    formRef.current?.reset()
    setSpoolWeightKg('')
    setSpoolPrice('')
    setColorHex('#ff0000')
  }

  const weight = parseFloat(spoolWeightKg)
  const price = parseFloat(spoolPrice)
  const hasWeightAndPrice = spoolWeightKg !== '' && spoolPrice !== '' && !isNaN(weight) && !isNaN(price) && weight > 0 && price > 0
  const pricePerKg = hasWeightAndPrice ? price / weight : NaN
  const pricePerGram = hasWeightAndPrice ? pricePerKg / 1000 : NaN
  const initialStockGrams = hasWeightAndPrice ? weight * 1000 : NaN

  return (
    <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
      <label className="text-sm">
        Marca/fabricante *
        <input name="manufacturer" placeholder="Marca/fabricante" className="tk-input-full" required defaultValue={editingFilament?.manufacturer} />
      </label>
      <label className="text-sm">
        Material *
        <select name="material" defaultValue={editingFilament?.material ?? 'PLA'} className="tk-input-full" required>
          {MATERIALS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Cor *
        <div className="mt-1 flex items-center gap-2">
          <input
            name="colorHex"
            type="color"
            value={colorHex}
            onChange={(e) => setColorHex(e.target.value)}
            className="h-9 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-700"
          />
          <input name="colorName" placeholder="Nome da cor" className="tk-input flex-1" required defaultValue={editingFilament?.colorName} />
        </div>
      </label>
      <label className="text-sm">
        Peso do rolo (kg) *
        <input
          name="spoolWeightKg"
          type="number"
          step="0.001"
          placeholder="Peso do rolo (kg)"
          className="tk-input-full"
          value={spoolWeightKg}
          onChange={(e) => setSpoolWeightKg(e.target.value)}
          required
        />
      </label>
      <label className="text-sm">
        Preço pago *
        <input
          name="spoolPrice"
          type="number"
          step="0.01"
          placeholder="Preço pago"
          className="tk-input-full"
          value={spoolPrice}
          onChange={(e) => setSpoolPrice(e.target.value)}
          required
        />
      </label>
      <div className="col-span-4 mt-2 flex items-center gap-3">
        <SubmitButton pendingLabel="Salvando…">{editingFilament ? 'Salvar alterações' : 'Adicionar'}</SubmitButton>
        {editingFilament && (
          <Link href="/filaments" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </Link>
        )}
      </div>
      <p className="col-span-4 text-xs text-slate-500 dark:text-slate-400">
        Preço do rolo: {formatOrDash(price)} · R$/kg: {formatOrDash(pricePerKg)} · R$/g: {Number.isFinite(pricePerGram) ? `R$ ${pricePerGram.toFixed(4)}` : '—'} · Estoque inicial: {Number.isFinite(initialStockGrams) ? `${initialStockGrams}g` : '—'}
      </p>
    </form>
  )
}
