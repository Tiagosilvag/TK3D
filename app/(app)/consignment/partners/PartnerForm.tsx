'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createConsignmentPartner, updateConsignmentPartner } from '@/actions/consignmentPartners'
import { SubmitButton } from '@/components/SubmitButton'

export type EditingPartner = {
  id: string
  name: string
  defaultCommissionPercent: number // fração 0-1
  notes: string | null
}

// Melhoria "Parceiros de consignação" §1/§10: cadastro deixa de ser um
// formulário fixo no topo da tela e vira modal (mesmo padrão <dialog>
// nativo já usado em Acessórios/Insumos/Embalagens), acionado por
// "+ Novo parceiro" ou por editar um parceiro existente a partir da
// página dedicada dele (item 4).
export function PartnerForm({
  open,
  onOpenChange,
  editingPartner,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingPartner?: EditingPartner
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function action(formData: FormData) {
    // Item 6: comissão digitada como porcentagem "de verdade" (0-100) --
    // convertida pra fração (0-1) só aqui, antes de chegar no schema/
    // servidor, que continua esperando 0-1 (mesmo ajuste já feito em
    // Configurações).
    const percent = Number(formData.get('defaultCommissionPercent'))
    formData.set('defaultCommissionPercent', String(percent / 100))

    const result = editingPartner
      ? await updateConsignmentPartner(editingPartner.id, formData)
      : await createConsignmentPartner(formData)

    if (!result.success) {
      alert(result.error)
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => onOpenChange(false)}
      className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form action={action} className="grid grid-cols-1 gap-3 p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">{editingPartner ? 'Editar parceiro' : 'Novo parceiro'}</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            ✕
          </button>
        </div>

        <label className="text-sm">
          Nome
          <input name="name" placeholder="Ex: Maria" className="tk-input-full" required defaultValue={editingPartner?.name} />
        </label>

        <div className="text-sm">
          <label className="block">
            Comissão padrão
            <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white px-2.5 transition-colors focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/30 dark:border-slate-700 dark:bg-slate-800">
              <input
                name="defaultCommissionPercent"
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="30"
                required
                defaultValue={editingPartner ? editingPartner.defaultCommissionPercent * 100 : undefined}
                className="w-full bg-transparent py-1.5 text-sm text-slate-900 focus:outline-none dark:text-slate-100"
              />
              <span className="ml-1 shrink-0 text-sm text-slate-400 dark:text-slate-500">%</span>
            </div>
          </label>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Aplicada por padrão nas vendas desse parceiro. Pode ser ajustada por venda depois.</p>
        </div>

        <label className="text-sm">
          Observações (opcional)
          <textarea name="notes" className="tk-input-full" rows={2} defaultValue={editingPartner?.notes ?? ''} />
        </label>

        <div className="mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </button>
          <SubmitButton pendingLabel="Salvando…">{editingPartner ? 'Salvar alterações' : 'Adicionar parceiro'}</SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
