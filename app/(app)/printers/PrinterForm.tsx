'use client'
import { useRef, useState } from 'react'
import { createPrinter } from '@/actions/printers'
import { formatCurrency } from '@/lib/format'

type SettingsForPreview = {
  annualMaintenancePercent: number
  annualUsageHours: number
  energyCostPerKwh: number
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

export function PrinterForm({ settings }: { settings: SettingsForPreview }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [purchasePrice, setPurchasePrice] = useState('')
  const [depreciationHours, setDepreciationHours] = useState('')
  const [avgPowerConsumptionKwh, setAvgPowerConsumptionKwh] = useState('')

  async function action(formData: FormData) {
    const result = await createPrinter(formData)
    if (result.success) {
      formRef.current?.reset()
      setPurchasePrice('')
      setDepreciationHours('')
      setAvgPowerConsumptionKwh('')
    } else {
      alert(result.error)
    }
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
      <input name="name" placeholder="Nome" className="tk-input" required />
      <input
        name="purchasePrice"
        type="number"
        step="0.01"
        placeholder="Preço"
        className="tk-input"
        value={purchasePrice}
        onChange={(e) => setPurchasePrice(e.target.value)}
        required
      />
      <input
        name="depreciationHours"
        type="number"
        step="1"
        placeholder="Horas depreciação"
        className="tk-input"
        value={depreciationHours}
        onChange={(e) => setDepreciationHours(e.target.value)}
        required
      />
      <input
        name="avgPowerConsumptionKwh"
        type="number"
        step="0.001"
        placeholder="Consumo kWh/h"
        className="tk-input"
        value={avgPowerConsumptionKwh}
        onChange={(e) => setAvgPowerConsumptionKwh(e.target.value)}
        required
      />
      <button className="col-span-4 mt-2 tk-btn-primary">Adicionar</button>
      <p className="col-span-4 text-xs text-slate-500 dark:text-slate-400">
        Depreciação: {formatOrDash(depCost)}/h · Manutenção: {formatOrDash(maintCost)}/h · Energia: {formatOrDash(electricityCost)}/h
      </p>
    </form>
  )
}
