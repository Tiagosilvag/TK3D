'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createPrinter, updatePrinter } from '@/actions/printers'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

type SettingsForPreview = {
  annualMaintenancePercent: number
  annualUsageHours: number
  energyCostPerKwh: number
}

type EditingPrinter = {
  id: string
  name: string
  purchasePrice: number
  depreciationHours: number
  avgPowerConsumptionKwh: number
}

// Duplicated on purpose: these are one-line pure formulas, and importing the
// server-only lib/costing.ts module into this client component just to reuse
// two one-liners isn't worth the client-bundle cost. Keep in sync with
// calculatePrinterDepreciationCostPerHour / calculatePrinterMaintenanceCostPerHour
// in lib/costing.ts if those formulas ever change.
function depreciationCostPerHour(purchasePrice: number, depreciationHours: number): number {
  return purchasePrice / depreciationHours
}
function maintenanceCostPerHour(purchasePrice: number, annualMaintenancePercent: number, annualUsageHours: number): number {
  return (purchasePrice * annualMaintenancePercent) / annualUsageHours
}

function formatOrDash(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return formatCurrency(value)
}

export function PrinterForm({
  settings,
  editingPrinter,
}: {
  settings: SettingsForPreview
  editingPrinter?: EditingPrinter
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [purchasePrice, setPurchasePrice] = useState(editingPrinter ? String(editingPrinter.purchasePrice) : '')
  const [depreciationHours, setDepreciationHours] = useState(editingPrinter ? String(editingPrinter.depreciationHours) : '')
  const [avgPowerConsumptionKwh, setAvgPowerConsumptionKwh] = useState(
    editingPrinter ? String(editingPrinter.avgPowerConsumptionKwh) : '',
  )

  async function action(formData: FormData) {
    const result = editingPrinter
      ? await updatePrinter(editingPrinter.id, formData)
      : await createPrinter(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    if (editingPrinter) {
      // Leave edit mode by dropping the ?editId= query param.
      router.push('/printers')
      return
    }
    formRef.current?.reset()
    setPurchasePrice('')
    setDepreciationHours('')
    setAvgPowerConsumptionKwh('')
  }

  const price = parseFloat(purchasePrice)
  const hours = parseFloat(depreciationHours)
  const power = parseFloat(avgPowerConsumptionKwh)

  const hasPriceAndHours = purchasePrice !== '' && depreciationHours !== '' && !isNaN(price) && !isNaN(hours) && price > 0 && hours > 0
  const depCost = hasPriceAndHours ? depreciationCostPerHour(price, hours) : NaN
  const maintCost = hasPriceAndHours ? maintenanceCostPerHour(price, settings.annualMaintenancePercent, settings.annualUsageHours) : NaN
  const hasPower = avgPowerConsumptionKwh !== '' && !isNaN(power) && power > 0
  const electricityCost = hasPower ? power * settings.energyCostPerKwh : NaN

  return (
    <form ref={formRef} action={action} className="grid grid-cols-4 gap-2 tk-panel p-4">
      <label className="text-sm">
        Nome *
        <input name="name" placeholder="Nome" className="tk-input-full" required defaultValue={editingPrinter?.name} />
      </label>
      <label className="text-sm">
        Preço *
        <input
          name="purchasePrice"
          type="number"
          step="0.01"
          placeholder="Preço"
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
          placeholder="Horas depreciação"
          className="tk-input-full"
          value={depreciationHours}
          onChange={(e) => setDepreciationHours(e.target.value)}
          required
        />
      </label>
      <label className="text-sm">
        Consumo kWh/h *
        <input
          name="avgPowerConsumptionKwh"
          type="number"
          step="0.001"
          placeholder="Consumo kWh/h"
          className="tk-input-full"
          value={avgPowerConsumptionKwh}
          onChange={(e) => setAvgPowerConsumptionKwh(e.target.value)}
          required
        />
      </label>
      <div className="col-span-4 mt-2 flex items-center gap-3">
        <SubmitButton pendingLabel="Salvando…">{editingPrinter ? 'Salvar alterações' : 'Adicionar'}</SubmitButton>
        {editingPrinter && (
          <Link href="/printers" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </Link>
        )}
      </div>
      <p className="col-span-4 text-xs text-slate-500 dark:text-slate-400">
        Depreciação: {formatOrDash(depCost)}/h · Manutenção: {formatOrDash(maintCost)}/h · Energia: {formatOrDash(electricityCost)}/h
      </p>
    </form>
  )
}
