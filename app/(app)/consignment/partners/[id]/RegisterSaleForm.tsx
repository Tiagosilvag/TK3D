'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createConsignmentSaleReport } from '@/actions/consignmentSaleReports'
import type { ConsignmentSaleableDelivery } from '@/lib/reports'
import { SubmitButton } from '@/components/SubmitButton'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// Bug "não tem opção de registrar venda do produto consignado": a única
// tela que registrava um ConsignmentSaleReport era /consignment/reports,
// um item de menu separado com um <select> de TODAS as entregas de TODOS
// os parceiros -- nada na própria página do parceiro (onde o usuário
// naturalmente está olhando o estoque dela) levava lá. Este botão+modal
// reaproveita a mesma action (createConsignmentSaleReport) e a mesma
// granularidade (uma ConsignmentDelivery específica, não o agregado por
// produto/cor que a seção de estoque mostra), só que com o <select> já
// filtrado às entregas DESTE parceiro (ConsignmentSaleableDelivery, ver
// getConsignmentPartnerDetail em lib/reports.ts).
export function RegisterSaleForm({
  deliveries,
  defaultCommissionPercent,
}: {
  deliveries: ConsignmentSaleableDelivery[]
  defaultCommissionPercent: number
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [deliveryId, setDeliveryId] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const selected = useMemo(() => deliveries.find((d) => d.deliveryId === deliveryId), [deliveries, deliveryId])

  function resetFields() {
    formRef.current?.reset()
    setDeliveryId('')
  }

  async function action(formData: FormData) {
    const result = await createConsignmentSaleReport(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    setOpen(false)
    resetFields()
    router.refresh()
  }

  if (deliveries.length === 0) return null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="tk-btn-primary px-3 py-1.5 text-sm">
        + Registrar venda
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => { setOpen(false); resetFields() }}
        className="w-full [--tk-dialog-cap:32rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form ref={formRef} action={action} className="grid gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Registrar venda</h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>

          <input type="hidden" name="commissionPercent" value={defaultCommissionPercent} />

          <label className="text-sm">
            Produto
            <select name="deliveryId" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)} className="tk-input-full" required>
              <option value="" disabled>Selecione</option>
              {deliveries.map((d) => (
                <option key={d.deliveryId} value={d.deliveryId}>
                  {d.productName}{d.colorLabel ? ` — ${d.colorLabel}` : ''} (saldo: {d.remaining})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Quantidade vendida
            <input
              name="quantitySold"
              type="number"
              step="1"
              min="1"
              max={selected?.remaining}
              className="tk-input-full"
              required
            />
            {selected && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Saldo disponível: {selected.remaining}</span>}
          </label>

          <label className="text-sm">
            Data do relatório
            <input name="reportDate" type="date" defaultValue={today()} className="tk-input-full" required />
          </label>

          <label className="text-sm">
            Observações (opcional)
            <textarea name="notes" className="tk-input-full" rows={1} />
          </label>

          <div className="mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
            <SubmitButton pendingLabel="Registrando…">Registrar venda</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
