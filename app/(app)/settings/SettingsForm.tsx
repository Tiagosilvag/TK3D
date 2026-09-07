'use client'
import { useState } from 'react'
import { updateSettings } from '@/actions/settings'

type SettingsValues = {
  energyCostPerKwh: number
  laborCostPerHour: number
  failureRatePercent: number
  marketplaceFeePercent: number
  taxPercent: number
  marketplaceFixedFee: number
  defaultMarkup: number
}

export function SettingsForm({ settings }: { settings: SettingsValues }) {
  const [message, setMessage] = useState<string | null>(null)

  async function action(formData: FormData) {
    const result = await updateSettings(formData)
    setMessage(result.success ? 'Configurações salvas com sucesso.' : (result.error ?? 'Erro ao salvar.'))
  }

  return (
    <form action={action} className="grid max-w-md grid-cols-1 gap-3 rounded-lg border border-slate-200 p-4">
      <label className="text-sm">
        Custo de energia (R$/kWh)
        <input name="energyCostPerKwh" type="number" step="0.0001" defaultValue={settings.energyCostPerKwh} className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Custo de mão de obra (R$/hora)
        <input name="laborCostPerHour" type="number" step="0.01" defaultValue={settings.laborCostPerHour} className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Taxa de falha (0 a 1)
        <input name="failureRatePercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.failureRatePercent} className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Taxa do marketplace (0 a 1)
        <input name="marketplaceFeePercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.marketplaceFeePercent} className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Imposto (0 a 1)
        <input name="taxPercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.taxPercent} className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Taxa fixa do marketplace (R$)
        <input name="marketplaceFixedFee" type="number" step="0.01" defaultValue={settings.marketplaceFixedFee} className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <label className="text-sm">
        Markup padrão
        <input name="defaultMarkup" type="number" step="0.01" defaultValue={settings.defaultMarkup} className="mt-1 w-full rounded border px-2 py-1 text-sm" required />
      </label>
      <button className="mt-2 rounded bg-slate-900 py-1.5 text-sm text-white hover:bg-slate-700">Salvar</button>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </form>
  )
}
