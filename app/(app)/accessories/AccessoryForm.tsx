'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createAccessory, createAccessoryMultiColor, updateAccessory } from '@/actions/accessories'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

type AccessoryTypeOption = { id: string; name: string }

type EditingAccessory = {
  id: string
  name: string
  type: string
  colorName: string
  colorHex: string | null
}

type ColorRow = { colorName: string; colorHex: string; quantity: string }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyColorRow(): ColorRow {
  return { colorName: '', colorHex: '#ff0000', quantity: '' }
}

export function AccessoryForm({
  accessoryTypes,
  editingAccessory,
}: {
  accessoryTypes: AccessoryTypeOption[]
  editingAccessory?: EditingAccessory
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [hasColor, setHasColor] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')
  const [colorRows, setColorRows] = useState<ColorRow[]>([emptyColorRow()])

  async function action(formData: FormData) {
    if (editingAccessory) {
      const result = await updateAccessory(editingAccessory.id, formData)
      if (!result.success) {
        alert(result.error)
        return
      }
      router.push('/accessories')
      return
    }

    let result
    if (hasColor) {
      formData.set('colorsJson', JSON.stringify(colorRows))
      result = await createAccessoryMultiColor(formData)
    } else {
      result = await createAccessory(formData)
    }
    if (result.success) {
      formRef.current?.reset()
      setHasColor(false)
      setQuantity('')
      setTotalCost('')
      setColorRows([emptyColorRow()])
    } else {
      alert(result.error)
    }
  }

  function updateColorRow(index: number, patch: Partial<ColorRow>) {
    setColorRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function removeColorRow(index: number) {
    setColorRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))
  }

  if (editingAccessory) {
    return (
      <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
        <label className="text-sm">
          Nome *
          <input name="name" placeholder="Nome" className="tk-input-full" required defaultValue={editingAccessory.name} />
        </label>
        <label className="text-sm">
          Tipo *
          <select name="type" className="tk-input-full" required defaultValue={editingAccessory.type}>
            {accessoryTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Cor (opcional)
          <div className="mt-1 flex items-center gap-2">
            <input
              name="colorHex"
              type="color"
              defaultValue={editingAccessory.colorHex ?? '#ff0000'}
              className="h-9 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-700"
            />
            <input name="colorName" placeholder="Nome da cor" className="tk-input flex-1" defaultValue={editingAccessory.colorName} />
          </div>
        </label>
        <div className="col-span-4 mt-2 flex items-center gap-3">
          <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>
          <Link href="/accessories" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
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

  const colorsTotalQty = colorRows.reduce((sum, r) => sum + (parseFloat(r.quantity) || 0), 0)
  const multiColorTotalCost = parseFloat(totalCost)
  const multiColorUnitCost = colorsTotalQty > 0 && !isNaN(multiColorTotalCost) && multiColorTotalCost > 0 ? multiColorTotalCost / colorsTotalQty : NaN

  return (
    <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
      <label className="text-sm">
        Nome *
        <input name="name" placeholder="Nome" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Tipo *
        <select name="type" className="tk-input-full" required defaultValue="">
          <option value="" disabled>Tipo</option>
          {accessoryTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>

      {!hasColor && (
        <>
          <label className="text-sm">
            Quantidade (1ª compra) *
            <input name="quantity" type="number" step="0.01" min="0.01" placeholder="Quantidade (1ª compra)" className="tk-input-full" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </label>
          <label className="text-sm">
            Valor total pago *
            <input name="totalCost" type="number" step="0.01" min="0.01" placeholder="Valor total pago" className="tk-input-full" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} required />
          </label>
        </>
      )}

      {hasColor && (
        <label className="text-sm">
          Valor total pago (todas as cores) *
          <input name="totalCost" type="number" step="0.01" min="0.01" placeholder="Valor total pago" className="tk-input-full" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} required />
        </label>
      )}

      <label className="col-span-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={hasColor}
          onChange={(e) => setHasColor(e.target.checked)}
          className="rounded border"
        />
        Este acessório tem uma cor específica
      </label>

      {!hasColor && (
        <input type="hidden" name="colorName" value="" />
      )}

      {hasColor && (
        <div className="col-span-4 space-y-2">
          {colorRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                value={row.colorHex}
                onChange={(e) => updateColorRow(i, { colorHex: e.target.value })}
                className="h-9 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-700"
                aria-label={`Cor da variação ${i + 1}`}
              />
              <input
                placeholder="Nome da cor"
                className="tk-input flex-1"
                value={row.colorName}
                onChange={(e) => updateColorRow(i, { colorName: e.target.value })}
                required
                aria-label={`Nome da cor da variação ${i + 1}`}
              />
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Quantidade"
                className="tk-input w-28"
                value={row.quantity}
                onChange={(e) => updateColorRow(i, { quantity: e.target.value })}
                required
                aria-label={`Quantidade da variação ${i + 1}`}
              />
              {colorRows.length > 1 && (
                <button type="button" onClick={() => removeColorRow(i)} className="tk-link-danger text-xs">
                  Remover
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setColorRows((rows) => [...rows, emptyColorRow()])} className="text-xs font-medium text-amber-600 hover:underline dark:text-amber-400">
            + Adicionar cor
          </button>
        </div>
      )}

      <label className="text-sm">
        Data da compra *
        <input name="purchaseDate" type="date" defaultValue={today()} className="tk-input-full" required />
      </label>
      <label className="col-span-3 text-sm">
        Observações (opcional)
        <input name="notes" placeholder="Observações (opcional)" className="tk-input-full" />
      </label>

      <div className="col-span-4 mt-2">
        <SubmitButton pendingLabel="Salvando…">Cadastrar acessório</SubmitButton>
      </div>
      <p className="col-span-4 text-xs text-slate-500 dark:text-slate-400">
        {hasColor
          ? `Custo unitário médio (todas as cores): ${Number.isFinite(multiColorUnitCost) ? formatCurrency(multiColorUnitCost) : '—'}`
          : `Custo unitário resultante: ${Number.isFinite(unitCost) ? formatCurrency(unitCost) : '—'}`}
      </p>
    </form>
  )
}
