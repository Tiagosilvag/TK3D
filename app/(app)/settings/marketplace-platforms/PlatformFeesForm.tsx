'use client'
import { useState } from 'react'
import { updateMarketplacePlatformFees } from '@/actions/marketplacePlatforms'
import { SubmitButton } from '@/components/SubmitButton'
import type { MarketplacePlatformKind } from '@prisma/client'

export function PlatformFeesForm({
  platform,
  label,
  feePercent,
  feeFixed,
  avgFreight,
}: {
  platform: MarketplacePlatformKind
  label: string
  feePercent: number
  feeFixed: number
  avgFreight: number
}) {
  const [message, setMessage] = useState<string | null>(null)

  async function action(formData: FormData) {
    const result = await updateMarketplacePlatformFees(platform, formData)
    setMessage(result.success ? 'Salvo.' : (result.error ?? 'Erro ao salvar.'))
  }

  return (
    <form action={action} className="grid gap-3 tk-panel p-4">
      <h2 className="font-display text-sm font-semibold">{label}</h2>
      <label className="text-sm">
        Taxa % (fração de 0 a 1) *
        <input name="feePercent" type="number" step="0.0001" min="0" max="1" defaultValue={feePercent} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Taxa fixa (R$) *
        <input name="feeFixed" type="number" step="0.01" min="0" defaultValue={feeFixed} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Frete médio (R$) *
        <input name="avgFreight" type="number" step="0.01" min="0" defaultValue={avgFreight} className="tk-input-full" required />
      </label>
      <div className="mt-1 flex items-center gap-3">
        <SubmitButton pendingLabel="Salvando…">Salvar</SubmitButton>
        {message && <span className="text-xs text-slate-500 dark:text-slate-400">{message}</span>}
      </div>
    </form>
  )
}
