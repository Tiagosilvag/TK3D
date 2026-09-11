'use client'
import { useState } from 'react'
import { updateSettings } from '@/actions/settings'
import { SubmitButton } from '@/components/SubmitButton'

type RoundingMode = 'NONE' | 'R90' | 'R99' | 'R00'

type SettingsValues = {
  energyCostPerKwh: number
  laborCostPerHour: number
  failureRatePercent: number
  marketplaceFeePercent: number
  taxPercent: number
  marketplaceFixedFee: number
  defaultMarkup: number
  annualMaintenancePercent: number
  annualUsageHours: number
  desiredMarginPercent: number
  defaultDiscountPercent: number
  stockLowThresholdPercent: number
  stockCriticalThresholdPercent: number
  includeDepreciation: boolean
  includeEnergyCost: boolean
  includeMaintenance: boolean
  includeLaborCost: boolean
  includeFailureRate: boolean
  includeFilamentCost: boolean
  includeAccessoriesCost: boolean
  includeSuppliesCost: boolean
  includePackagingCost: boolean
  roundingMode: RoundingMode
}

const costCompositionFlags: { name: keyof SettingsValues & string; label: string }[] = [
  { name: 'includeFilamentCost', label: 'Filamento' },
  { name: 'includeDepreciation', label: 'Depreciação da impressora' },
  { name: 'includeMaintenance', label: 'Manutenção da impressora' },
  { name: 'includeEnergyCost', label: 'Energia elétrica' },
  { name: 'includeLaborCost', label: 'Mão de obra' },
  { name: 'includeFailureRate', label: 'Taxa de falha' },
  { name: 'includeSuppliesCost', label: 'Insumos' },
  { name: 'includePackagingCost', label: 'Embalagem' },
  { name: 'includeAccessoriesCost', label: 'Acessórios' },
]

const roundingModeOptions: { value: RoundingMode; label: string }[] = [
  { value: 'NONE', label: 'Nenhum (valor exato)' },
  { value: 'R90', label: 'Terminar em ,90' },
  { value: 'R99', label: 'Terminar em ,99' },
  { value: 'R00', label: 'Terminar em ,00 (inteiro)' },
]

export function SettingsForm({ settings }: { settings: SettingsValues }) {
  const [message, setMessage] = useState<string | null>(null)

  async function action(formData: FormData) {
    const result = await updateSettings(formData)
    setMessage(result.success ? 'Configurações salvas com sucesso.' : (result.error ?? 'Erro ao salvar.'))
  }

  return (
    <form action={action} className="grid max-w-2xl grid-cols-1 gap-6 tk-panel p-4">
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Custos</legend>
        <label className="text-sm">
          Custo de energia (R$/kWh) *
          <input name="energyCostPerKwh" type="number" step="0.0001" min="0.0001" defaultValue={settings.energyCostPerKwh} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Custo de mão de obra (R$/hora) *
          <input name="laborCostPerHour" type="number" step="0.01" min="0.01" defaultValue={settings.laborCostPerHour} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Taxa de falha (0 a 1) *
          <input name="failureRatePercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.failureRatePercent} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Manutenção anual estimada (0 a 1, % do preço de compra da impressora) *
          <input name="annualMaintenancePercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.annualMaintenancePercent} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Horas de uso estimadas por ano (por impressora) *
          <input name="annualUsageHours" type="number" step="1" min="1" defaultValue={settings.annualUsageHours} className="tk-input-full" required />
        </label>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Precificação</legend>
        <label className="text-sm">
          Taxa do marketplace (0 a 1) *
          <input name="marketplaceFeePercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.marketplaceFeePercent} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Imposto (0 a 1) *
          <input name="taxPercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.taxPercent} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Taxa fixa do marketplace (R$) *
          <input name="marketplaceFixedFee" type="number" step="0.01" min="0" defaultValue={settings.marketplaceFixedFee} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Markup padrão *
          <input name="defaultMarkup" type="number" step="0.01" min="0.01" defaultValue={settings.defaultMarkup} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Margem desejada (0 a 1) *
          <input name="desiredMarginPercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.desiredMarginPercent} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Desconto padrão (0 a 1) *
          <input name="defaultDiscountPercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.defaultDiscountPercent} className="tk-input-full" required />
        </label>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Estoque (acessórios e insumos)</legend>
        <label className="text-sm">
          Limiar de estoque baixo (0 a 1) *
          <input name="stockLowThresholdPercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.stockLowThresholdPercent} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Limiar de estoque crítico (0 a 1) *
          <input name="stockCriticalThresholdPercent" type="number" step="0.0001" min="0" max="1" defaultValue={settings.stockCriticalThresholdPercent} className="tk-input-full" required />
        </label>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold">Composição do custo</legend>
        {costCompositionFlags.map(({ name, label }) => (
          <label key={name} className="flex items-center gap-2 text-sm">
            <input name={name} type="checkbox" value="true" defaultChecked={settings[name] as boolean} className="rounded border" />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Arredondamento do preço final</legend>
        {roundingModeOptions.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="roundingMode" value={value} defaultChecked={settings.roundingMode === value} className="border" required />
            {label}
          </label>
        ))}
      </fieldset>

      <SubmitButton pendingLabel="Salvando…" className="mt-2 tk-btn-primary">Salvar</SubmitButton>
      {message && <p className="text-sm text-slate-600 dark:text-slate-400">{message}</p>}
    </form>
  )
}
