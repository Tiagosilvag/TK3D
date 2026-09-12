'use client'
import { useMemo, useState } from 'react'
import { simulateProductPrice, applyRounding, type RoundingMode } from '@/lib/costing'
import { applyProductPrice } from '@/actions/products'
import { formatCurrency } from '@/lib/format'

// Preço §2 (task-6 brief): "Simulação de preço" — temporary, client-side-only
// overrides for markup/margin/discount (useState, never persisted). Initial
// state is Settings' own current values, so before the user touches any
// control the section already shows a default calculated price preview
// (simulateProductPrice with discount=0 and margin below the markup price
// reproduces the exact same suggestedPrice/marketplacePrice as the
// CostBreakdown panel above it — see lib/costing.ts's simulateProductPrice
// doc comment). The ONLY write to the DB is the "Aplicar preço calculado"
// button, via the applyProductPrice server action — every recalculation
// above it is pure client-side math.
export function PriceSimulation({
  productId,
  finalCost,
  defaultMarkup,
  defaultMarginPercent,
  defaultDiscountPercent,
  marketplaceFeePercent,
  taxPercent,
  marketplaceFixedFee,
  roundingMode,
  roundingCustomCents,
  currentSuggestedPrice,
  currentMarketplacePrice,
}: {
  productId: string
  finalCost: number
  defaultMarkup: number
  defaultMarginPercent: number
  defaultDiscountPercent: number
  marketplaceFeePercent: number
  taxPercent: number
  marketplaceFixedFee: number
  // Fix 4 (task-10 brief): Settings.roundingMode, applied to the final
  // suggested/marketplace price shown here -- same value applyProductPrice
  // applies again before persisting (lib/costing.ts#applyRounding is a
  // no-op on an already-rounded number, so preview and persisted value
  // always agree).
  roundingMode: RoundingMode
  // Configurações §7: só usado quando roundingMode='CUSTOM'.
  roundingCustomCents: number | null
  currentSuggestedPrice: number | null
  currentMarketplacePrice: number | null
}) {
  const [markup, setMarkup] = useState(defaultMarkup)
  const [marginPercent, setMarginPercent] = useState(defaultMarginPercent)
  const [discountPercent, setDiscountPercent] = useState(defaultDiscountPercent)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const result = useMemo(() => {
    const raw = simulateProductPrice({
      finalCost,
      markup,
      marginPercent,
      discountPercent,
      marketplaceFeePercent,
      taxPercent,
      marketplaceFixedFee,
    })
    // Fix 4: rounding applies ONLY to the final price, never to any cost
    // component upstream of it -- applied here, after simulateProductPrice
    // has already produced the final suggested/marketplace figures.
    return {
      suggestedPrice: applyRounding(raw.suggestedPrice, roundingMode, roundingCustomCents ?? undefined),
      marketplacePrice: applyRounding(raw.marketplacePrice, roundingMode, roundingCustomCents ?? undefined),
    }
  }, [finalCost, markup, marginPercent, discountPercent, marketplaceFeePercent, taxPercent, marketplaceFixedFee, roundingMode, roundingCustomCents])

  async function handleApply() {
    setApplying(true)
    setMessage(null)
    const response = await applyProductPrice(productId, result.suggestedPrice, result.marketplacePrice)
    setApplying(false)
    setMessage(response.success ? 'Preço aplicado com sucesso.' : response.error ?? 'Erro ao aplicar preço.')
  }

  return (
    <div className="mt-6 tk-panel p-4">
      <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Simulação de preço</h2>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Ajuste markup, margem e desconto para simular — nada é gravado até clicar em &quot;Aplicar preço calculado&quot;.
      </p>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <label>
          Markup
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={markup}
            onChange={(e) => setMarkup(Number(e.target.value))}
            className="tk-input-full"
          />
        </label>
        <label>
          Margem desejada (0 a 1)
          <input
            type="number"
            step="0.0001"
            min="0"
            max="0.999"
            value={marginPercent}
            onChange={(e) => setMarginPercent(Number(e.target.value))}
            className="tk-input-full"
          />
        </label>
        <label>
          Desconto (0 a 1)
          <input
            type="number"
            step="0.0001"
            min="0"
            max="1"
            value={discountPercent}
            onChange={(e) => setDiscountPercent(Number(e.target.value))}
            className="tk-input-full"
          />
        </label>
      </div>

      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex justify-between font-semibold text-violet-700 dark:text-violet-400">
          <dt>Preço sugerido (simulado)</dt>
          <dd>{formatCurrency(result.suggestedPrice)}</dd>
        </div>
        <div className="flex justify-between font-semibold text-violet-700 dark:text-violet-400">
          <dt>Preço marketplace (simulado)</dt>
          <dd>{formatCurrency(result.marketplacePrice)}</dd>
        </div>
        {currentSuggestedPrice != null && (
          <div className="flex justify-between text-slate-500 dark:text-slate-400">
            <dt>Preço sugerido aplicado atualmente</dt>
            <dd>{formatCurrency(currentSuggestedPrice)}</dd>
          </div>
        )}
        {currentMarketplacePrice != null && (
          <div className="flex justify-between text-slate-500 dark:text-slate-400">
            <dt>Preço marketplace aplicado atualmente</dt>
            <dd>{formatCurrency(currentMarketplacePrice)}</dd>
          </div>
        )}
      </dl>

      <button type="button" onClick={handleApply} disabled={applying} className="mt-3 tk-btn-primary">
        {applying ? 'Aplicando...' : 'Aplicar preço calculado'}
      </button>
      {message && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{message}</p>}
    </div>
  )
}
