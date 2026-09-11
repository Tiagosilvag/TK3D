'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPrinter, updatePrinter } from '@/actions/printers'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

function depreciationCostPerHour(purchasePrice: number, depreciationHours: number): number {
  return purchasePrice / depreciationHours
}

function formatOrDash(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return formatCurrency(value)
}

export type EditingPrinter = {
  id: string
  name: string
  nickname: string | null
  purchasePrice: number
  depreciationHours: number
  avgPowerConsumptionKwh: number
  energyCostPerKwh: number
  maintenanceCostPerHour: number
  bambuEnabled: boolean
  bambuSerial: string | null
}

// Melhorias "Impressoras": formulário virou modal (<dialog> nativo, mesmo
// padrão de FilamentForm/AdjustStockButton -- sem lib nova) acionado por
// "Nova impressora" ou por ?editId= (padrão do app, ver page.tsx).
// Controlado externamente via `open`/`onOpenChange`; `key={editingPrinter?.id
// ?? 'new'}` no ponto de uso remonta o form (reresseta os campos
// controlados) a cada troca entre "nova" e "editando X".
export function PrinterForm({
  open,
  onOpenChange,
  editingPrinter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingPrinter?: EditingPrinter
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [purchasePrice, setPurchasePrice] = useState(editingPrinter ? String(editingPrinter.purchasePrice) : '')
  const [depreciationHours, setDepreciationHours] = useState(editingPrinter ? String(editingPrinter.depreciationHours) : '')
  const [avgPowerConsumptionKwh, setAvgPowerConsumptionKwh] = useState(
    editingPrinter ? String(editingPrinter.avgPowerConsumptionKwh) : '',
  )
  const [energyCostPerKwh, setEnergyCostPerKwh] = useState(editingPrinter ? String(editingPrinter.energyCostPerKwh) : '')
  const [maintenanceCostPerHour, setMaintenanceCostPerHour] = useState(
    editingPrinter ? String(editingPrinter.maintenanceCostPerHour) : '',
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function action(formData: FormData) {
    const result = editingPrinter
      ? await updatePrinter(editingPrinter.id, formData)
      : await createPrinter(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  function resetFields() {
    formRef.current?.reset()
    setPurchasePrice(editingPrinter ? String(editingPrinter.purchasePrice) : '')
    setDepreciationHours(editingPrinter ? String(editingPrinter.depreciationHours) : '')
    setAvgPowerConsumptionKwh(editingPrinter ? String(editingPrinter.avgPowerConsumptionKwh) : '')
    setEnergyCostPerKwh(editingPrinter ? String(editingPrinter.energyCostPerKwh) : '')
    setMaintenanceCostPerHour(editingPrinter ? String(editingPrinter.maintenanceCostPerHour) : '')
  }

  const price = parseFloat(purchasePrice)
  const hours = parseFloat(depreciationHours)
  const power = parseFloat(avgPowerConsumptionKwh)
  const tariff = parseFloat(energyCostPerKwh)
  const maintenance = parseFloat(maintenanceCostPerHour)

  const hasPriceAndHours = purchasePrice !== '' && depreciationHours !== '' && !isNaN(price) && !isNaN(hours) && price > 0 && hours > 0
  const depCost = hasPriceAndHours ? depreciationCostPerHour(price, hours) : NaN
  const hasPowerAndTariff = avgPowerConsumptionKwh !== '' && energyCostPerKwh !== '' && !isNaN(power) && !isNaN(tariff) && power >= 0 && tariff >= 0
  const electricityCost = hasPowerAndTariff ? power * tariff : NaN
  const hasMaintenance = maintenanceCostPerHour !== '' && !isNaN(maintenance) && maintenance >= 0
  const maintCost = hasMaintenance ? maintenance : NaN
  const totalCost = [depCost, electricityCost, maintCost].every(Number.isFinite)
    ? depCost + electricityCost + maintCost
    : NaN

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetFields() }}
      className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 p-5">
        <div className="col-span-2 mb-1 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">{editingPrinter ? 'Editar impressora' : 'Nova impressora'}</h3>
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
          <input name="name" placeholder="Ex: Anycubic Kobra X" className="tk-input-full" required defaultValue={editingPrinter?.name} />
        </label>
        <label className="col-span-2 text-sm">
          Apelido (opcional)
          <input name="nickname" placeholder="Ex: Cassiopeia" className="tk-input-full" defaultValue={editingPrinter?.nickname ?? ''} />
        </label>

        <label className="text-sm">
          Preço (R$) *
          <input
            name="purchasePrice"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0,00"
            className="tk-input-full"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(e.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          Vida útil (h) *
          <input
            name="depreciationHours"
            type="number"
            step="1"
            min="1"
            placeholder="8000"
            className="tk-input-full"
            value={depreciationHours}
            onChange={(e) => setDepreciationHours(e.target.value)}
            required
          />
        </label>

        <label className="text-sm">
          Consumo (kWh/h) *
          <input
            name="avgPowerConsumptionKwh"
            type="number"
            step="0.001"
            min="0.001"
            placeholder="0,12"
            className="tk-input-full"
            value={avgPowerConsumptionKwh}
            onChange={(e) => setAvgPowerConsumptionKwh(e.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          Tarifa energia (R$/kWh) *
          <input
            name="energyCostPerKwh"
            type="number"
            step="0.01"
            min="0"
            placeholder="0,85"
            className="tk-input-full"
            value={energyCostPerKwh}
            onChange={(e) => setEnergyCostPerKwh(e.target.value)}
            required
          />
        </label>

        <label className="col-span-2 text-sm">
          Manutenção estimada (R$/h) *
          <input
            name="maintenanceCostPerHour"
            type="number"
            step="0.01"
            min="0"
            placeholder="0,18"
            className="tk-input-full"
            value={maintenanceCostPerHour}
            onChange={(e) => setMaintenanceCostPerHour(e.target.value)}
            required
          />
        </label>

        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="bambuEnabled" defaultChecked={editingPrinter?.bambuEnabled ?? false} />
          Integração Bambu Lab (monitoramento)
        </label>
        <label className="col-span-2 text-sm">
          Número de série Bambu (opcional)
          <input name="bambuSerial" placeholder="Ex: 01P00A000000000" className="tk-input-full" defaultValue={editingPrinter?.bambuSerial ?? ''} />
        </label>

        <div className="col-span-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Preview de custo</p>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Depreciação</p>
              <p className="font-medium">{Number.isFinite(depCost) ? `${formatOrDash(depCost)}/h` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Energia</p>
              <p className="font-medium">{Number.isFinite(electricityCost) ? `${formatOrDash(electricityCost)}/h` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Manutenção</p>
              <p className="font-medium">{Number.isFinite(maintCost) ? `${formatOrDash(maintCost)}/h` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Total R$/h</p>
              <p className="font-semibold text-amber-600 dark:text-amber-400">{Number.isFinite(totalCost) ? `${formatOrDash(totalCost)}/h` : '—'}</p>
            </div>
          </div>
        </div>

        <div className="col-span-2 mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </button>
          <SubmitButton pendingLabel="Salvando…">{editingPrinter ? 'Salvar alterações' : 'Adicionar'}</SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
