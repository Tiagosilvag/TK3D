'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  calculateChannelPriceForMargin,
  calculateChannelMinPrice,
  calculateListingPriceForDesiredProfit,
  evaluateChannelPrice,
  roundUpToNinety,
  type PlatformFeeTier,
} from '@/lib/costing'
import { applyProductChannelPrice, applyProductChannelPrices } from '@/actions/products'
import { formatCurrency } from '@/lib/format'
import { UndoToast } from '@/components/UndoToast'

export interface ChannelOption {
  key: string
  label: string
  feePercent: number
  feeFixed: number
  feeTiers: PlatformFeeTier[] | null
  feeLabel: string
  currentPrice: number | null
}

type Mode = 'margem' | 'lucro'

const MARGIN_PRESETS = [0.15, 0.2, 0.25, 0.3, 0.4]
const PROFIT_PRESETS = [3, 5, 8, 10, 15]
const MAX_MARGIN = 0.6

function clampMargin(m: number): number {
  return Math.max(0, Math.min(MAX_MARGIN, m))
}

// Redesign "Produto › Preço por canal" (task-11 brief): seção NOVA,
// separada do painel "Custo (ao vivo)" (CostBreakdown.tsx, continua
// existindo exatamente como antes, sempre visível -- pedido explícito
// "não tire o custo ao vivo") -- substitui só as antigas linhas "Preço
// marketplace"/"Preço sugerido" (1 valor genérico pros dois marketplaces
// juntos, que nunca batia certo com nenhum dos dois de verdade -- taxas
// bem diferentes) por 1 card por canal de venda, cada um respondendo
// "quanto cobrar aqui pra uma margem de X%", nunca "quanto sobra se eu
// cobrar o preço de outro canal". Toda a matemática vem de
// lib/costing.ts#calculateChannelPriceForMargin/
// calculateListingPriceForDesiredProfit/calculateChannelMinPrice/
// evaluateChannelPrice -- deliberadamente SEM imposto (diferente do
// antigo calculatePlatformPrice, que misturava taxa% de plataforma com
// Settings.taxPercent numa fórmula só e por isso "não fechava" quando
// alguém conferia preço−taxa à mão -- ver comentário "Atenção" no prompt
// original). Nada é gravado até clicar "Usar este preço"/"Usar estes
// preços em todos os canais" -- toda recomputação acima disso é só
// matemática em memória (useMemo), mesmo princípio de nunca gravar antes
// do clique explícito que PriceSimulation.tsx já seguia.
export function ChannelPricing({
  productId,
  cost,
  channels,
  defaultMarginPercent,
  children,
}: {
  productId: string
  cost: number
  channels: ChannelOption[]
  defaultMarginPercent: number
  // Markup/desconto promocional (PriceSimulation.tsx) continuam existindo
  // -- "ficam num Avançado ▾ recolhido, não somem, só saem do caminho" --
  // passados como children em vez de reimplementados aqui, só escondidos/
  // mostrados por este componente.
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('margem')
  const [marginPercent, setMarginPercent] = useState(clampMargin(defaultMarginPercent))
  const [profitValue, setProfitValue] = useState(5)
  const [roundTo90, setRoundTo90] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [applyingKey, setApplyingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const results = useMemo(() => {
    return channels.map((ch) => {
      const rawPrice =
        mode === 'margem'
          ? calculateChannelPriceForMargin({ cost, marginPercent, tiers: ch.feeTiers, flatFeePercent: ch.feePercent, flatFeeFixed: ch.feeFixed })
          : calculateListingPriceForDesiredProfit({
              desiredProfit: profitValue,
              productionCost: cost,
              freightCost: 0,
              giftCost: 0,
              tiers: ch.feeTiers,
              flatFeePercent: ch.feePercent,
              flatFeeFixed: ch.feeFixed,
            })
      const price = roundTo90 ? roundUpToNinety(rawPrice) : Math.round(rawPrice * 100) / 100
      const minPrice = calculateChannelMinPrice({ cost, tiers: ch.feeTiers, flatFeePercent: ch.feePercent, flatFeeFixed: ch.feeFixed })
      const target = evaluateChannelPrice(price, cost, ch.feeTiers, ch.feePercent, ch.feeFixed)
      const today = ch.currentPrice != null ? evaluateChannelPrice(ch.currentPrice, cost, ch.feeTiers, ch.feePercent, ch.feeFixed) : null
      const applied = ch.currentPrice != null && Math.abs(ch.currentPrice - price) < 0.005
      return { ...ch, price, minPrice, target, today, applied }
    })
  }, [channels, cost, mode, marginPercent, profitValue, roundTo90])

  async function handleApplyOne(key: string, label: string, price: number) {
    setApplyingKey(key)
    const result = await applyProductChannelPrice(productId, key, price, mode === 'margem' ? marginPercent : null)
    setApplyingKey(null)
    if (!result.success) {
      alert(result.error ?? 'Erro ao aplicar preço')
      return
    }
    setToast(`${label}: preço ${formatCurrency(price)} aplicado`)
    router.refresh()
  }

  async function handleApplyAll() {
    setApplyingKey('__all__')
    const items = results.map((r) => ({ channel: r.key, price: r.price, marginTarget: mode === 'margem' ? marginPercent : null }))
    const result = await applyProductChannelPrices(productId, items)
    setApplyingKey(null)
    if (!result.success) {
      alert(result.error ?? 'Erro ao aplicar preços')
      return
    }
    setToast(`Preço aplicado em ${items.length} canais`)
    router.refresh()
  }

  return (
    <div className="mt-6 tk-panel p-4">
      <div>
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Preço por canal</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Escolha quanto quer lucrar e veja o preço certo em cada lugar que você vende. Custo final: {formatCurrency(cost)} (detalhado no painel &quot;Custo (ao vivo)&quot; acima).</p>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Quero lucrar</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setMode('margem')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${mode === 'margem' ? 'bg-violet-600 text-white dark:bg-violet-500' : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              Margem %
            </button>
            <button
              type="button"
              onClick={() => setMode('lucro')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${mode === 'lucro' ? 'bg-violet-600 text-white dark:bg-violet-500' : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              Lucro em R$
            </button>
          </div>

          {mode === 'margem' ? (
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setMarginPercent((m) => clampMargin(Math.round(m * 100) / 100 - 0.01))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">−</button>
              <span className="w-14 text-center text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{Math.round(marginPercent * 100)}%</span>
              <button type="button" onClick={() => setMarginPercent((m) => clampMargin(Math.round(m * 100) / 100 + 0.01))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">+</button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setProfitValue((v) => Math.max(0, Math.round((v - 0.5) * 100) / 100))} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">−</button>
              <span className="w-16 text-center text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(profitValue)}</span>
              <button type="button" onClick={() => setProfitValue((v) => Math.round((v + 0.5) * 100) / 100)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">+</button>
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {(mode === 'margem' ? MARGIN_PRESETS : PROFIT_PRESETS).map((preset) => {
              const active = mode === 'margem' ? Math.abs(marginPercent - preset) < 0.001 : Math.abs(profitValue - preset) < 0.001
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => (mode === 'margem' ? setMarginPercent(clampMargin(preset)) : setProfitValue(preset))}
                  className={`rounded-full border px-2 py-1 text-xs font-medium transition-colors ${active ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-600 dark:border-slate-700 dark:text-slate-300'}`}
                >
                  {mode === 'margem' ? `${Math.round(preset * 100)}%` : formatCurrency(preset)}
                </button>
              )
            })}
          </div>

          <label className="ml-auto flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={roundTo90} onChange={(e) => setRoundTo90(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
            Arredondar em ,90
          </label>
        </div>

        {mode === 'margem' && (
          <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
            {Math.round(marginPercent * 100)}% de margem = de cada R$ 100 vendidos, {formatCurrency(marginPercent * 100)} sobram de lucro, depois de pagar o custo ({formatCurrency(cost)}) e a taxa do canal.
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {results.map((r) => {
          const custoWidth = r.target.price > 0 ? Math.min(100, (cost / r.target.price) * 100) : 0
          const taxaWidth = r.target.price > 0 ? Math.min(100 - custoWidth, (r.target.feeAmount / r.target.price) * 100) : 0
          const lucroWidth = Math.max(0, 100 - custoWidth - taxaWidth)
          const todayMargin = r.today?.marginPercent ?? null
          const targetMargin = r.target.marginPercent
          const todayTone = todayMargin == null ? null : todayMargin < 0 ? 'red' : todayMargin >= targetMargin - 0.005 ? 'green' : 'amber'
          return (
            <div key={r.key} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.label}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{r.feeLabel}</p>
                </div>
                {todayTone && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      todayTone === 'green'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                        : todayTone === 'amber'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                    }`}
                  >
                    Hoje {formatCurrency(r.currentPrice!)} · {Math.round((todayMargin ?? 0) * 100)}%
                  </span>
                )}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Preço p/ {mode === 'margem' ? `${Math.round(marginPercent * 100)}%` : formatCurrency(profitValue)} de lucro
                  </p>
                  <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(r.price)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Mínimo · lucro zero</p>
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{formatCurrency(r.minPrice)}</p>
                </div>
              </div>

              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span className="bg-red-400" style={{ width: `${custoWidth}%` }} />
                <span className="bg-amber-400" style={{ width: `${taxaWidth}%` }} />
                <span className="bg-emerald-400" style={{ width: `${lucroWidth}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Custo {formatCurrency(cost)} · Taxa {formatCurrency(r.target.feeAmount)} · Lucro {formatCurrency(r.target.profit)} · {Math.round(r.target.marginPercent * 100)}%
              </p>

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">Você recebe {formatCurrency(r.target.received)}</span>
                <button
                  type="button"
                  onClick={() => handleApplyOne(r.key, r.label, r.price)}
                  disabled={applyingKey === r.key || r.applied}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                    r.applied ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'tk-btn-primary'
                  }`}
                >
                  {r.applied ? '✓ Preço aplicado' : applyingKey === r.key ? 'Aplicando…' : 'Usar este preço'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button type="button" onClick={() => setAdvancedOpen((v) => !v)} className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400">
          {advancedOpen ? 'Ocultar avançado (markup/desconto) ▴' : 'Avançado (markup/desconto) ▾'}
        </button>
        <button type="button" onClick={handleApplyAll} disabled={applyingKey === '__all__'} className="tk-btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
          {applyingKey === '__all__' ? 'Aplicando…' : 'Usar estes preços em todos os canais'}
        </button>
      </div>

      {advancedOpen && children}

      {toast && <UndoToast message={toast} onDismiss={() => setToast(null)} durationMs={4000} />}
    </div>
  )
}
