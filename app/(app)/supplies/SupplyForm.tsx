'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupply, updateSupply } from '@/actions/supplies'
import { formatCurrency, SUPPLY_UNIT_SUFFIX } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import type { SupplyUnit } from '@prisma/client'

const SUPPLY_UNITS: { value: SupplyUnit; label: string }[] = [
  { value: 'UN', label: 'Unidade' },
  { value: 'ML', label: 'Mililitro' },
  { value: 'G', label: 'Grama' },
  { value: 'M', label: 'Metro' },
  { value: 'OUTRO', label: 'Outro' },
]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatOrDash(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return formatCurrency(value)
}

export type EditingSupply = { id: string; name: string; unit: SupplyUnit; defaultUsage: number | null }

// Melhoria "Insumos": formulário vira modal (mesmo padrão de PackagingForm/
// FilamentForm), acionado por "Novo insumo" ou por ?editId=. Criar =
// registrar a primeira compra (mesmo raciocínio de Accessory/Supply/
// PackagingItem já usado aqui). "Uso padrão" é o novo campo (opcional) --
// pré-preenche a quantidade sempre que esse insumo é adicionado numa
// ficha técnica (products/[id]/page.tsx), continua editável tanto no
// cadastro/edição do insumo quanto ali. Sufixo de unidade ao lado do
// campo acompanha a Unidade selecionada (SUPPLY_UNIT_SUFFIX), pra deixar
// claro que "1" significa "1 ml" ou "1 g" dependendo do insumo.
export function SupplyForm({
  open,
  onOpenChange,
  editingSupply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingSupply?: EditingSupply
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [unit, setUnit] = useState<SupplyUnit | ''>(editingSupply?.unit ?? '')
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function action(formData: FormData) {
    const result = editingSupply
      ? await updateSupply(editingSupply.id, formData)
      : await createSupply(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  function resetFields() {
    formRef.current?.reset()
    setUnit(editingSupply?.unit ?? '')
    setQuantity('')
    setTotalCost('')
  }

  const qty = parseFloat(quantity)
  const cost = parseFloat(totalCost)
  const hasBoth = quantity !== '' && totalCost !== '' && !isNaN(qty) && !isNaN(cost) && qty > 0 && cost > 0
  const unitCost = hasBoth ? cost / qty : NaN
  const unitSuffix = unit ? SUPPLY_UNIT_SUFFIX[unit] : null

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetFields() }}
      className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 p-5">
        <div className="col-span-2 mb-1 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">{editingSupply ? 'Editar insumo' : 'Novo insumo'}</h3>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Fechar"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <label className="col-span-2 text-sm">
          Nome *
          <input name="name" placeholder="Ex: Cola Tekbond" className="tk-input-full" required defaultValue={editingSupply?.name} />
        </label>

        <label className="text-sm">
          Unidade *
          <select
            name="unit"
            className="tk-input-full"
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value as SupplyUnit)}
          >
            <option value="" disabled>Unidade</option>
            {SUPPLY_UNITS.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          Uso padrão por produção
          <div className="flex items-center gap-1">
            <input
              name="defaultUsage"
              type="number"
              step="0.001"
              min="0.001"
              placeholder="Ex: 1"
              className="tk-input-full"
              defaultValue={editingSupply?.defaultUsage ?? ''}
            />
            {unitSuffix && <span className="text-slate-400 dark:text-slate-500">{unitSuffix}</span>}
          </div>
          <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
            Pré-preenche a quantidade sempre que esse insumo for adicionado num produto ou produção.
          </span>
        </label>

        {!editingSupply && (
          <>
            <label className="text-sm">
              Quantidade (1ª compra) *
              <input
                name="quantity"
                type="number"
                step="0.001"
                min="0.001"
                placeholder="0"
                className="tk-input-full"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              Valor total pago (R$) *
              <input
                name="totalCost"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0,00"
                className="tk-input-full"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              Data da compra *
              <input name="purchaseDate" type="date" defaultValue={today()} className="tk-input-full" required />
            </label>
            <label className="text-sm">
              Observações (opcional)
              <input name="notes" className="tk-input-full" />
            </label>
          </>
        )}

        {!editingSupply && (
          <div className="col-span-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Preview</p>
            <p className="text-sm">
              <span className="text-xs text-slate-500 dark:text-slate-400">Custo unitário resultante: </span>
              <span className="font-medium">{formatOrDash(unitCost)}</span>
            </p>
          </div>
        )}

        <div className="col-span-2 mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </button>
          <SubmitButton pendingLabel="Salvando…">{editingSupply ? 'Salvar alterações' : 'Cadastrar insumo'}</SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
