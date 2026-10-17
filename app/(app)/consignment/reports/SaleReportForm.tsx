'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createConsignmentSaleReport } from '@/actions/consignmentSaleReports'
import { todayInBrasiliaString as today } from '@/lib/timezone'

export type DeliveryOption = {
  id: string
  partnerName: string
  productName: string
  remaining: number
  defaultCommissionPercent: number
  unitPrice: number
}

// Redesign "Relatórios de venda": vira um modal controlado (mesmo padrão
// open/onOpenChange + <dialog> de DeliveryBatchForm.tsx em Entregas) -- o
// formulário saiu do topo da página, que empurrava a lista inteira pra
// baixo. Lógica de campos (pré-preencher preço/comissão da entrega
// escolhida, sobrescrever unitPrice só quando diferente do cadastrado)
// idêntica à versão anterior, só a casca mudou.
export function SaleReportForm({
  open,
  onOpenChange,
  deliveries,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deliveries: DeliveryOption[]
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [deliveryId, setDeliveryId] = useState('')
  const [commissionPercent, setCommissionPercent] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => deliveries.find((d) => d.id === deliveryId), [deliveries, deliveryId])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function resetAll() {
    setDeliveryId('')
    setCommissionPercent('')
    setUnitPrice('')
    setError(null)
  }

  function handleDeliveryChange(id: string) {
    setDeliveryId(id)
    const delivery = deliveries.find((d) => d.id === id)
    if (delivery) {
      setCommissionPercent(String(Math.round(delivery.defaultCommissionPercent * 100)))
      setUnitPrice(String(delivery.unitPrice))
    }
  }

  async function action(formData: FormData) {
    setError(null)
    if (selected) {
      const price = parseFloat(unitPrice)
      formData.set('unitPrice', price !== selected.unitPrice ? String(price) : '')
      formData.set('commissionPercent', String((parseFloat(commissionPercent) || 0) / 100))
    }
    const result = await createConsignmentSaleReport(formData)
    if (!result.success) {
      setError(result.error ?? 'Erro ao registrar venda')
      return
    }
    onOpenChange(false)
    resetAll()
    router.refresh()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetAll() }}
      className="w-full [--tk-dialog-cap:28rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form action={action} className="grid grid-cols-1 gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Registrar venda</h3>
          <button type="button" onClick={() => { onOpenChange(false); resetAll() }} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{error}</div>}

        <label className="text-sm">
          Entrega
          <select
            name="deliveryId"
            value={deliveryId}
            onChange={(e) => handleDeliveryChange(e.target.value)}
            className="tk-input-full"
            required
          >
            <option value="" disabled>Selecione</option>
            {deliveries.map((d) => (
              <option key={d.id} value={d.id}>
                {d.partnerName} — {d.productName} (saldo: {d.remaining})
              </option>
            ))}
          </select>
          {deliveries.length === 0 && (
            <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">Nenhuma entrega com saldo disponível pra vender.</span>
          )}
        </label>
        <div className="grid grid-cols-2 gap-3">
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
            {selected && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Saldo: {selected.remaining}</span>}
          </label>
          <label className="text-sm">
            Data do relatório
            <input name="reportDate" type="date" defaultValue={today()} className="tk-input-full" required />
          </label>
          <label className="text-sm">
            Preço unit. (R$)
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="tk-input-full"
              required
            />
          </label>
          <label className="text-sm">
            Comissão (%)
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={commissionPercent}
              onChange={(e) => setCommissionPercent(e.target.value)}
              className="tk-input-full"
              required
            />
          </label>
        </div>
        <label className="text-sm">
          Observações (opcional)
          <textarea name="notes" className="tk-input-full" rows={2} />
        </label>

        <div className="mt-1 flex justify-end gap-3">
          <button type="button" onClick={() => { onOpenChange(false); resetAll() }} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
          <button className="tk-btn-primary px-4 py-1.5 text-sm">Registrar venda</button>
        </div>
      </form>
    </dialog>
  )
}
