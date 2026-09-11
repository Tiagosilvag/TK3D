'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPackagingItem, updatePackagingItem } from '@/actions/packaging'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

function formatOrDash(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return formatCurrency(value)
}

export type EditingPackagingItem = {
  id: string
  name: string
  minStock: number
}

// Melhorias "Embalagens": formulário virou modal (<dialog> nativo, mesmo
// padrão de FilamentForm/PrinterForm) acionado por "Nova embalagem" ou
// por ?editId=. Criar = registrar a primeira compra (Nome + Valor total
// pago + Unidades compradas -> custo unitário calculado, preview ao
// vivo) -- editar só corrige Nome/Estoque mínimo (nunca estoque/custo,
// que só mudam via "Repor estoque", RestockForm.tsx).
export function PackagingForm({
  open,
  onOpenChange,
  editingItem,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingItem?: EditingPackagingItem
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function action(formData: FormData) {
    const result = editingItem
      ? await updatePackagingItem(editingItem.id, formData)
      : await createPackagingItem(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  function resetFields() {
    formRef.current?.reset()
    setQuantity('')
    setTotalCost('')
  }

  const qty = parseFloat(quantity)
  const cost = parseFloat(totalCost)
  const hasBoth = quantity !== '' && totalCost !== '' && !isNaN(qty) && !isNaN(cost) && qty > 0 && cost > 0
  const unitCost = hasBoth ? cost / qty : NaN

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetFields() }}
      className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 p-5">
        <div className="col-span-2 mb-1 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">{editingItem ? 'Editar embalagem' : 'Nova embalagem'}</h3>
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
          <input name="name" placeholder="Ex: Caixa Grande" className="tk-input-full" required defaultValue={editingItem?.name} />
        </label>

        {!editingItem && (
          <>
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
              Unidades compradas *
              <input
                name="quantity"
                type="number"
                step="1"
                min="1"
                placeholder="0"
                className="tk-input-full"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </label>
          </>
        )}

        <label className="col-span-2 text-sm">
          Estoque mínimo (un) *
          <input name="minStock" type="number" step="1" min="0" placeholder="0" className="tk-input-full" required defaultValue={editingItem?.minStock ?? 0} />
          <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">Abaixo desse valor, o item aparece como estoque baixo.</span>
        </label>

        {!editingItem && (
          <div className="col-span-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Preview</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Custo unitário (calculado)</p>
                <p className="font-medium">{formatOrDash(unitCost)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Status inicial</p>
                <p className="font-medium">{hasBoth ? (qty > 0 ? 'Em estoque' : '—') : '—'}</p>
              </div>
            </div>
          </div>
        )}

        <div className="col-span-2 mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </button>
          <SubmitButton pendingLabel="Salvando…">{editingItem ? 'Salvar alterações' : 'Adicionar'}</SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
