'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { adjustStock } from '@/actions/stockAdjustments'
import { STOCK_ADJUSTMENT_REASON_LABELS } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import type { StockAdjustmentReason } from '@prisma/client'

const REASONS = Object.entries(STOCK_ADJUSTMENT_REASON_LABELS) as [StockAdjustmentReason, string][]

// 2.6: botão "Ajustar estoque" reutilizado em Filamentos/Acessórios/
// Insumos/Meu Estoque -- abre um <dialog> nativo (sem lib nova) com nova
// quantidade + motivo obrigatório (texto livre só quando motivo = Outro).
// Zerar estoque é só informar 0 aqui, sem botão separado.
export function AdjustStockButton({
  resourceType,
  resourceId,
  resourceName,
  currentQuantity,
  unitLabel = '',
}: {
  resourceType: 'FILAMENT' | 'ACCESSORY' | 'SUPPLY' | 'PRODUCT' | 'PACKAGING'
  resourceId: string
  resourceName: string
  currentQuantity: number
  unitLabel?: string
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState<StockAdjustmentReason | ''>('')

  async function action(formData: FormData) {
    const result = await adjustStock(formData)
    if (result.success) {
      dialogRef.current?.close()
      setReason('')
      router.refresh()
    } else {
      alert(result.error)
    }
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className="text-xs text-amber-600 hover:underline dark:text-amber-400">
        Ajustar estoque
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setReason('')}
        className="w-80 rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form action={action} className="grid gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Ajustar estoque</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {resourceName} — quantidade atual: {currentQuantity}{unitLabel}
          </p>
          <input type="hidden" name="resourceType" value={resourceType} />
          <input type="hidden" name="resourceId" value={resourceId} />
          <label className="text-sm">
            Nova quantidade *
            <input name="newQty" type="number" step="0.001" min="0" defaultValue={currentQuantity} required className="tk-input-full" />
          </label>
          <label className="text-sm">
            Motivo *
            <select
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as StockAdjustmentReason)}
              required
              className="tk-input-full"
            >
              <option value="" disabled>Selecione</option>
              {REASONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {reason === 'OUTRO' && (
            <label className="text-sm">
              Descreva o motivo *
              <input name="reasonNote" required className="tk-input-full" />
            </label>
          )}
          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <SubmitButton pendingLabel="Salvando…">Confirmar ajuste</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
