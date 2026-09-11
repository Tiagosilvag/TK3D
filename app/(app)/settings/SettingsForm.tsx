'use client'
import { useState } from 'react'
import { updateSettings } from '@/actions/settings'
import { updateMarketplacePlatformFees } from '@/actions/marketplacePlatforms'
import { SubmitButton } from '@/components/SubmitButton'
import type { MarketplacePlatformKind } from '@prisma/client'

type RoundingMode = 'NONE' | 'R90' | 'R99' | 'R00' | 'CUSTOM'

// Item 3 do brief: campos guardados como fração (0 a 1, até 4 casas
// decimais no banco) exibidos como porcentagem "de verdade" (0 a 100).
// `fraction * 100` sozinho sofre de ruído de ponto flutuante binário (ex:
// 0.14 * 100 = 14.000000000000002) -- arredonda pra no máximo 2 casas
// decimais, suficiente pra cobrir as 4 casas decimais da fração original.
function toPercentDisplay(fraction: number): number {
  return Math.round(fraction * 10000) / 100
}

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
  roundingCustomCents: number | null
}

type PlatformValues = {
  platform: MarketplacePlatformKind
  feePercent: number
  feeFixed: number
  avgFreight: number
}

const PLATFORM_LABELS: Record<MarketplacePlatformKind, string> = { MERCADO_LIVRE: 'Mercado Livre', SHOPEE: 'Shopee' }
const PLATFORM_ORDER: MarketplacePlatformKind[] = ['MERCADO_LIVRE', 'SHOPEE']

// Campos que o usuário digita como porcentagem "de verdade" (0 a 100, ex.
// "10" pra 10%) -- convertidos pra fração (0 a 1) só no momento do submit,
// já que é isso que settingsSchema/feesSchema (Zod) continuam esperando no
// servidor. Ver item 3 do brief: evita a conversão mental "0.1 = 10%" que o
// formulário antigo exigia em todo campo desse tipo.
const PERCENT_FIELD_NAMES = new Set([
  'failureRatePercent',
  'annualMaintenancePercent',
  'taxPercent',
  'desiredMarginPercent',
  'defaultDiscountPercent',
  'stockLowThresholdPercent',
  'stockCriticalThresholdPercent',
  'marketplaceFeePercent',
])

const costCompositionFlags: { name: keyof SettingsValues & string; label: string }[] = [
  { name: 'includeFilamentCost', label: 'Filamento' },
  { name: 'includeDepreciation', label: 'Deprec. impressora' },
  { name: 'includeMaintenance', label: 'Manut. impressora' },
  { name: 'includeEnergyCost', label: 'Energia elétrica' },
  { name: 'includeLaborCost', label: 'Mão de obra' },
  { name: 'includeFailureRate', label: 'Taxa de falha' },
  { name: 'includeSuppliesCost', label: 'Insumos' },
  { name: 'includePackagingCost', label: 'Embalagem' },
  { name: 'includeAccessoriesCost', label: 'Acessórios' },
]

const roundingModeOptions: { value: RoundingMode; label: string }[] = [
  { value: 'NONE', label: 'Valor exato' },
  { value: 'R90', label: 'Terminar em ,90' },
  { value: 'R99', label: 'Terminar em ,99' },
  { value: 'R00', label: 'Inteiro (,00)' },
  { value: 'CUSTOM', label: 'Personalizado' },
]

// Card com título + frase curta explicando pra que serve aquele grupo de
// campos (item 1 do brief) -- reduz a leitura campo-a-campo pra entender
// onde uma seção termina e outra começa.
function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="tk-panel p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      <div className="mt-4">{children}</div>
    </div>
  )
}

// Campo numérico com prefixo/sufixo dentro da mesma caixa (ex: "R$ [0,85]
// /kWh", "[10] %") -- em vez de rótulo + input soltos, deixa a unidade
// visível junto do valor sem precisar repetir no texto do label.
function AffixInput({
  name,
  defaultValue,
  prefix,
  suffix,
  step = '0.01',
  min = '0',
  max,
  required = true,
}: {
  name: string
  defaultValue: number
  prefix?: string
  suffix?: string
  step?: string
  min?: string
  max?: string
  required?: boolean
}) {
  return (
    <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white px-2.5 transition-colors focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/30 dark:border-slate-700 dark:bg-slate-800">
      {prefix && <span className="mr-1 shrink-0 text-sm text-slate-400 dark:text-slate-500">{prefix}</span>}
      <input
        name={name}
        type="number"
        step={step}
        min={min}
        max={max}
        defaultValue={defaultValue}
        required={required}
        className="w-full bg-transparent py-1.5 text-sm text-slate-900 focus:outline-none dark:text-slate-100"
      />
      {suffix && <span className="ml-1 shrink-0 whitespace-nowrap text-sm text-slate-400 dark:text-slate-500">{suffix}</span>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm text-slate-700 dark:text-slate-300">
      {label}
      {children}
    </label>
  )
}

// Linha vertical de Precificação (item 4 do brief): rótulo + descrição em
// linguagem simples à esquerda, valor à direita -- em vez de campos lado a
// lado sem contexto, que confundem conceitos parecidos (Markup vs Margem).
function PricingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 first:pt-0 last:border-0 last:pb-0 dark:border-slate-800">
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
        <p className="mt-0.5 max-w-sm text-xs text-slate-400 dark:text-slate-500">{description}</p>
      </div>
      <div className="w-24 shrink-0">{children}</div>
    </div>
  )
}

// Card pequeno com toggle (item 6): mais fácil escanear o estado de cada um
// dos 9 flags do que checkbox solto ao lado do texto.
function ToggleField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-700">
      <span className="text-slate-700 dark:text-slate-300">{label}</span>
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-amber-600 peer-checked:after:translate-x-4 dark:bg-slate-700 dark:peer-checked:bg-amber-500" />
    </label>
  )
}

export function SettingsForm({ settings, platforms }: { settings: SettingsValues; platforms: PlatformValues[] }) {
  const [message, setMessage] = useState<string | null>(null)
  const [roundingMode, setRoundingMode] = useState<RoundingMode>(settings.roundingMode)
  const platformByKind = new Map(platforms.map((p) => [p.platform, p]))

  async function action(formData: FormData) {
    // Reparte a submissão única do formulário em 3 chamadas de action
    // (Settings + 2 MarketplacePlatform), convertendo os campos de
    // porcentagem digitados como 0-100 de volta pra fração 0-1 que o
    // servidor espera -- ver PERCENT_FIELD_NAMES acima.
    const settingsData = new FormData()
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('platform_')) continue
      settingsData.set(key, PERCENT_FIELD_NAMES.has(key) ? String(Number(value) / 100) : value)
    }

    const platformResults = await Promise.all(
      PLATFORM_ORDER.map((kind) => {
        const pfd = new FormData()
        pfd.set('feePercent', String(Number(formData.get(`platform_${kind}_feePercent`)) / 100))
        pfd.set('feeFixed', String(formData.get(`platform_${kind}_feeFixed`)))
        pfd.set('avgFreight', String(formData.get(`platform_${kind}_avgFreight`)))
        return updateMarketplacePlatformFees(kind, pfd)
      }),
    )
    const settingsResult = await updateSettings(settingsData)

    const firstError = !settingsResult.success ? settingsResult.error : platformResults.find((r) => !r.success)?.error
    setMessage(firstError ?? 'Configurações salvas com sucesso.')
  }

  return (
    <form action={action} className="grid max-w-2xl grid-cols-1 gap-4 pb-24">
      <Card title="Custos" description="Usado para calcular o custo real de produção por hora.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Custo de energia">
            <AffixInput name="energyCostPerKwh" defaultValue={settings.energyCostPerKwh} prefix="R$" suffix="/kWh" step="0.0001" min="0.0001" />
          </Field>
          <Field label="Custo de mão de obra">
            <AffixInput name="laborCostPerHour" defaultValue={settings.laborCostPerHour} prefix="R$" suffix="/hora" min="0.01" />
          </Field>
          <Field label="Taxa de falha">
            <AffixInput name="failureRatePercent" defaultValue={toPercentDisplay(settings.failureRatePercent)} suffix="%" max="100" />
          </Field>
          <Field label="Manutenção anual estimada">
            <AffixInput name="annualMaintenancePercent" defaultValue={toPercentDisplay(settings.annualMaintenancePercent)} suffix="% do preço" max="100" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Horas de uso por ano">
              <AffixInput name="annualUsageHours" defaultValue={settings.annualUsageHours} step="1" min="1" />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Precificação" description="Define como o preço final de venda é calculado.">
        <div>
          <PricingRow label="Imposto" description="Percentual descontado do preço de venda para impostos.">
            <AffixInput name="taxPercent" defaultValue={toPercentDisplay(settings.taxPercent)} suffix="%" max="100" />
          </PricingRow>
          <PricingRow label="Markup padrão" description="Multiplica o custo de produção para chegar no preço de venda. Ex: custo R$ 10 x markup 2 = preço R$ 20.">
            <AffixInput name="defaultMarkup" defaultValue={settings.defaultMarkup} suffix="x" min="0.01" />
          </PricingRow>
          <PricingRow label="Margem desejada" description="Quanto do preço de venda deve sobrar como lucro, depois de todos os custos.">
            <AffixInput name="desiredMarginPercent" defaultValue={toPercentDisplay(settings.desiredMarginPercent)} suffix="%" max="100" />
          </PricingRow>
          <PricingRow label="Desconto padrão" description="Desconto já aplicado automaticamente em todo produto, antes de qualquer promoção manual.">
            <AffixInput name="defaultDiscountPercent" defaultValue={toPercentDisplay(settings.defaultDiscountPercent)} suffix="%" max="100" />
          </PricingRow>
        </div>

        {/* id usado pelo item "Marketplaces" do menu lateral
            (AppLayoutClient.tsx) -- aponta pra cá em vez de reviver a tela
            separada /settings/marketplace-platforms, removida nesta mesma
            leva de melhorias. */}
        <div id="marketplaces" className="mt-5 scroll-mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Marketplaces</p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Taxa % e taxa fixa de cada plataforma — usadas pra sugerir o preço ao registrar uma venda por esse canal.</p>
          <div className="mt-3 space-y-3">
            {PLATFORM_ORDER.map((kind) => {
              const p = platformByKind.get(kind)
              if (!p) return null
              return (
                <div key={kind} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-3 dark:border-slate-700">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 sm:self-center">{PLATFORM_LABELS[kind]}</p>
                  <Field label="Taxa">
                    <AffixInput name={`platform_${kind}_feePercent`} defaultValue={toPercentDisplay(p.feePercent)} suffix="%" max="100" />
                  </Field>
                  <Field label="Taxa fixa">
                    <AffixInput name={`platform_${kind}_feeFixed`} defaultValue={p.feeFixed} prefix="R$" />
                  </Field>
                  <Field label="Frete médio">
                    <AffixInput name={`platform_${kind}_avgFreight`} defaultValue={p.avgFreight} prefix="R$" />
                  </Field>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Marketplace genérico</p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Estimativa usada antes de existir uma plataforma específica configurada acima.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Taxa">
              <AffixInput name="marketplaceFeePercent" defaultValue={toPercentDisplay(settings.marketplaceFeePercent)} suffix="%" max="100" />
            </Field>
            <Field label="Taxa fixa">
              <AffixInput name="marketplaceFixedFee" defaultValue={settings.marketplaceFixedFee} prefix="R$" />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Estoque" description="Limiares usados em acessórios e insumos.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Limiar de estoque baixo">
            <AffixInput name="stockLowThresholdPercent" defaultValue={toPercentDisplay(settings.stockLowThresholdPercent)} suffix="%" max="100" />
          </Field>
          <Field label="Limiar de estoque crítico">
            <AffixInput name="stockCriticalThresholdPercent" defaultValue={toPercentDisplay(settings.stockCriticalThresholdPercent)} suffix="%" max="100" />
          </Field>
        </div>
      </Card>

      <Card title="Composição do custo" description="O que entra no cálculo do custo total de produção.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {costCompositionFlags.map(({ name, label }) => (
            <ToggleField key={name} name={name} label={label} defaultChecked={settings[name] as boolean} />
          ))}
        </div>
      </Card>

      <Card title="Arredondamento do preço final" description="Como o preço calculado é ajustado para exibição.">
        <input type="hidden" name="roundingMode" value={roundingMode} />
        <div className="flex flex-wrap gap-2">
          {roundingModeOptions.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setRoundingMode(value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                roundingMode === value
                  ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {roundingMode === 'CUSTOM' && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              Terminar em ,
              <input
                name="roundingCustomCents"
                type="number"
                step="1"
                min="0"
                max="99"
                defaultValue={settings.roundingCustomCents ?? 50}
                required
                className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            <span className="text-xs text-slate-400 dark:text-slate-500">Ex: 50 arredonda para R$ 19,50, R$ 24,50 etc.</span>
          </div>
        )}
      </Card>

      {/* Item 8 do brief: botão fixo no rodapé da área rolável (<main
          overflow-y-auto> em AppLayoutClient), sempre visível sem precisar
          rolar de volta ao fim da tela toda vez que um campo é ajustado. */}
      <div className="sticky bottom-0 flex items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>
        {message && <p className="text-sm text-slate-600 dark:text-slate-400">{message}</p>}
      </div>
    </form>
  )
}
