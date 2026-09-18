'use client'
import { useState } from 'react'
import { updateSettings } from '@/actions/settings'
import { updateMarketplacePlatformFees } from '@/actions/marketplacePlatforms'
import { SubmitButton } from '@/components/SubmitButton'
import type { MarketplacePlatformKind } from '@prisma/client'
import type { PlatformFeeTier } from '@/lib/costing'

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
  productLowStockThreshold: number
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
  // Melhoria "Shopee: taxa por faixa de preço" -- null pra plataforma sem
  // faixas configuradas ainda (a seção de Mercado Livre abaixo também
  // passou a usar feeTiers, ver kind === 'MERCADO_LIVRE' no render).
  feeTiers: PlatformFeeTier[] | null
  // Melhoria "Mercado Livre: taxa por faixa de preço" -- nota livre da
  // categoria a que a comissão se refere, só usada nesse branch.
  categoryReference: string | null
}

const PLATFORM_LABELS: Record<MarketplacePlatformKind, string> = { MERCADO_LIVRE: 'Mercado Livre', SHOPEE: 'Shopee' }
const PLATFORM_ORDER: MarketplacePlatformKind[] = ['MERCADO_LIVRE', 'SHOPEE']
// Faixas de taxa da Shopee são sempre estas 5, fixas na UI (ver plano) --
// nenhum editor de adicionar/remover, só os valores de cada faixa mudam.
const SHOPEE_TIER_COUNT = 5

// Melhoria "Mercado Livre: taxa por faixa de preço": mesma ideia de 5
// faixas fixas, mas aqui a comissão é ÚNICA (um campo só, não por faixa) e
// só a faixa 1 tem o componente extra "50% do valor" -- ver o branch
// kind === 'MERCADO_LIVRE' em action() e no render abaixo.
const ML_TIER_COUNT = 5
const ML_DEFAULT_MAX_PRICES = [12.5, 29.99, 49.99, 78.99]
const ML_COMMISSION_PRESETS: Record<'CLASSICO' | 'PREMIUM', number> = { CLASSICO: 12, PREMIUM: 17 }

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
    <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white px-2.5 transition-colors focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-800">
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
      <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-violet-600 peer-checked:after:translate-x-4 dark:bg-slate-700 dark:peer-checked:bg-violet-500" />
    </label>
  )
}

export function SettingsForm({ settings, platforms }: { settings: SettingsValues; platforms: PlatformValues[] }) {
  const [message, setMessage] = useState<string | null>(null)
  const [roundingMode, setRoundingMode] = useState<RoundingMode>(settings.roundingMode)
  const platformByKind = new Map(platforms.map((p) => [p.platform, p]))

  // Melhoria "Mercado Livre: taxa por faixa de preço": comissão é um campo
  // controlado (precisa mudar de valor quando o toggle Clássico/Premium é
  // clicado, `defaultValue` sozinho não reage a isso) -- mesmo padrão do
  // `unitPrice` controlado em SaleForm.tsx. Valor inicial vem da faixa 2
  // (única faixa que já é só a comissão pura, sem o +50% da faixa 1).
  // Toggle em si nunca é persistido (não tem coluna pra isso, nem precisa
  // -- é só um atalho de preenchimento), sempre reseta pra "Clássico".
  const mlTiers = platformByKind.get('MERCADO_LIVRE')?.feeTiers ?? null
  const [mlListingType, setMlListingType] = useState<'CLASSICO' | 'PREMIUM'>('CLASSICO')
  const [mlCommission, setMlCommission] = useState<number>(
    mlTiers && mlTiers[1] ? toPercentDisplay(mlTiers[1].feePercent) : ML_COMMISSION_PRESETS.CLASSICO,
  )

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
        if (kind === 'SHOPEE') {
          // Melhoria "Shopee: taxa por faixa de preço": monta as 5 faixas a
          // partir dos inputs individuais -- feePercent/feeFixed "achatados"
          // (colunas NOT NULL) recebem a 1ª faixa como espelho, nunca lidos
          // de verdade depois que feeTiers existe (ver getPlatformSalePrice).
          const tiers: { maxPrice: number | null; feePercent: number; feeFixed: number }[] = []
          for (let i = 1; i <= SHOPEE_TIER_COUNT; i++) {
            const isLast = i === SHOPEE_TIER_COUNT
            const maxPriceRaw = formData.get(`platform_SHOPEE_tier${i}_maxPrice`)
            tiers.push({
              maxPrice: isLast ? null : Number(maxPriceRaw),
              feePercent: Number(formData.get(`platform_SHOPEE_tier${i}_feePercent`)) / 100,
              feeFixed: Number(formData.get(`platform_SHOPEE_tier${i}_feeFixed`)),
            })
          }
          pfd.set('feePercent', String(tiers[0].feePercent))
          pfd.set('feeFixed', String(tiers[0].feeFixed))
          pfd.set('feeTiersJson', JSON.stringify(tiers))
        } else if (kind === 'MERCADO_LIVRE') {
          // Melhoria "Mercado Livre: taxa por faixa de preço": uma comissão
          // só (não por faixa, diferente da Shopee) -- a faixa 1 soma +50%
          // (o componente "50% do valor" que o ML cobra só nela), as
          // faixas 2-5 usam a mesma comissão com taxa fixa própria (faixa
          // 5 sempre isenta). Ver prisma/schema.prisma#MarketplacePlatform
          // e ML_TIER_COUNT/ML_DEFAULT_MAX_PRICES acima.
          const commission = Number(formData.get('platform_MERCADO_LIVRE_commissionPercent')) / 100
          const maxPrices = Array.from({ length: ML_TIER_COUNT - 1 }, (_, idx) =>
            Number(formData.get(`platform_MERCADO_LIVRE_tier${idx + 1}_maxPrice`)),
          )
          const tiers: { maxPrice: number | null; feePercent: number; feeFixed: number }[] = [
            { maxPrice: maxPrices[0], feePercent: commission + 0.5, feeFixed: 0 },
            { maxPrice: maxPrices[1], feePercent: commission, feeFixed: Number(formData.get('platform_MERCADO_LIVRE_tier2_feeFixed')) },
            { maxPrice: maxPrices[2], feePercent: commission, feeFixed: Number(formData.get('platform_MERCADO_LIVRE_tier3_feeFixed')) },
            { maxPrice: maxPrices[3], feePercent: commission, feeFixed: Number(formData.get('platform_MERCADO_LIVRE_tier4_feeFixed')) },
            { maxPrice: null, feePercent: commission, feeFixed: 0 },
          ]
          pfd.set('feePercent', String(tiers[0].feePercent))
          pfd.set('feeFixed', String(tiers[0].feeFixed))
          pfd.set('feeTiersJson', JSON.stringify(tiers))
          pfd.set('categoryReference', String(formData.get('platform_MERCADO_LIVRE_categoryReference') ?? ''))
        } else {
          pfd.set('feePercent', String(Number(formData.get(`platform_${kind}_feePercent`)) / 100))
          pfd.set('feeFixed', String(formData.get(`platform_${kind}_feeFixed`)))
        }
        pfd.set('avgFreight', String(formData.get(`platform_${kind}_avgFreight`)))
        return updateMarketplacePlatformFees(kind, pfd)
      }),
    )
    const settingsResult = await updateSettings(settingsData)

    const firstError = !settingsResult.success ? settingsResult.error : platformResults.find((r) => !r.success)?.error
    setMessage(firstError ?? 'Configurações salvas com sucesso.')
  }

  return (
    <form action={action} className="grid max-w-2xl grid-cols-1 gap-4 pb-36">
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
              // Melhoria "Shopee: taxa por faixa de preço": só a Shopee tem
              // feeTiers -- vira uma tabelinha de 5 faixas fixas em vez do
              // par único Taxa/Taxa fixa. Mercado Livre continua com o
              // layout de sempre, sem faixas.
              if (kind === 'SHOPEE') {
                const tiers = p.feeTiers ?? []
                return (
                  <div key={kind} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{PLATFORM_LABELS[kind]}</p>
                      <div className="w-40">
                        <Field label="Frete médio">
                          <AffixInput name={`platform_${kind}_avgFreight`} defaultValue={p.avgFreight} prefix="R$" />
                        </Field>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                      Taxa por faixa de preço da venda (taxa cheia, sem o subsídio Pix -- varia por transação, tratado como margem extra eventual).
                    </p>
                    <div className="mt-2 space-y-2">
                      {Array.from({ length: SHOPEE_TIER_COUNT }, (_, idx) => {
                        const i = idx + 1
                        const isLast = i === SHOPEE_TIER_COUNT
                        const tier = tiers[idx]
                        return (
                          <div key={i} className="grid grid-cols-3 items-end gap-2">
                            <Field label={isLast ? 'Acima de' : 'Até R$'}>
                              {isLast ? (
                                <p className="mt-1 rounded-lg border border-transparent px-2.5 py-1.5 text-sm text-slate-500 dark:text-slate-400">
                                  R$ {tiers[idx - 1]?.maxPrice?.toFixed(2) ?? '—'}
                                </p>
                              ) : (
                                <AffixInput name={`platform_SHOPEE_tier${i}_maxPrice`} defaultValue={tier?.maxPrice ?? 0} prefix="R$" />
                              )}
                            </Field>
                            <Field label="Taxa">
                              <AffixInput name={`platform_SHOPEE_tier${i}_feePercent`} defaultValue={toPercentDisplay(tier?.feePercent ?? 0)} suffix="%" max="100" />
                            </Field>
                            <Field label="Taxa fixa">
                              <AffixInput name={`platform_SHOPEE_tier${i}_feeFixed`} defaultValue={tier?.feeFixed ?? 0} prefix="R$" />
                            </Field>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              }
              // Melhoria "Mercado Livre: taxa por faixa de preço": mesma
              // ideia da Shopee (5 faixas fixas), mas a comissão é ÚNICA
              // (um campo controlado só, ver mlCommission acima) em vez de
              // uma % por faixa -- só a faixa 1 (até R$12,50) soma +50%
              // (o componente "50% do valor" que o ML cobra só nela) e a
              // faixa 5 (acima de R$79) é sempre isenta. Coluna "Taxa" de
              // cada linha é só leitura (reflete mlCommission), não um
              // input por faixa -- editar a comissão é sempre pelo campo
              // único acima.
              if (kind === 'MERCADO_LIVRE') {
                const tiers = p.feeTiers ?? []
                const maxPrices = ML_DEFAULT_MAX_PRICES.map((def, idx) => tiers[idx]?.maxPrice ?? def)
                return (
                  <div key={kind} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{PLATFORM_LABELS[kind]}</p>
                      <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                        {(['CLASSICO', 'PREMIUM'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              setMlListingType(t)
                              setMlCommission(ML_COMMISSION_PRESETS[t])
                            }}
                            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                              mlListingType === t
                                ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
                                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                            }`}
                          >
                            {t === 'CLASSICO' ? 'Clássico' : 'Premium'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                      Comissão por tipo de anúncio + custo fixo por faixa de preço da venda (acima de R$ 79,00 não há custo fixo). A comissão não muda com o número de vendas — reputação e histórico afetam o custo de frete subsidiado, não a taxa em si.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Comissão da categoria">
                        <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white px-2.5 transition-colors focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-800">
                          <input
                            name="platform_MERCADO_LIVRE_commissionPercent"
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={mlCommission}
                            onChange={(e) => setMlCommission(Number(e.target.value))}
                            required
                            className="w-full bg-transparent py-1.5 text-sm text-slate-900 focus:outline-none dark:text-slate-100"
                          />
                          <span className="ml-1 shrink-0 text-sm text-slate-400 dark:text-slate-500">%</span>
                        </div>
                      </Field>
                      <Field label="Categoria de referência">
                        <input
                          name="platform_MERCADO_LIVRE_categoryReference"
                          defaultValue={p.categoryReference ?? ''}
                          placeholder="ex.: Casa, Móveis e Decoração"
                          className="tk-input-full"
                        />
                      </Field>
                    </div>

                    <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">Custo fixo por faixa de preço</p>
                    <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Cobrado além da comissão, só em vendas abaixo de R$ 79,00.</p>
                    <div className="mt-2 space-y-2">
                      {Array.from({ length: ML_TIER_COUNT }, (_, idx) => {
                        const i = idx + 1
                        const isFirst = idx === 0
                        const isLast = i === ML_TIER_COUNT
                        const effectivePercent = mlCommission + (isFirst ? 50 : 0)
                        return (
                          <div key={i} className="grid grid-cols-3 items-end gap-2">
                            <Field label={isLast ? 'Acima de' : 'Até R$'}>
                              {isLast ? (
                                <p className="mt-1 rounded-lg border border-transparent px-2.5 py-1.5 text-sm text-slate-500 dark:text-slate-400">
                                  R$ {maxPrices[ML_TIER_COUNT - 2].toFixed(2)}
                                </p>
                              ) : (
                                <AffixInput name={`platform_MERCADO_LIVRE_tier${i}_maxPrice`} defaultValue={maxPrices[idx]} prefix="R$" />
                              )}
                            </Field>
                            <Field label="Taxa">
                              <p className="mt-1 rounded-lg border border-transparent px-2.5 py-1.5 text-sm text-slate-500 dark:text-slate-400">
                                {effectivePercent.toFixed(2)}%
                              </p>
                            </Field>
                            <Field label="Taxa fixa">
                              {isFirst ? (
                                <p className="mt-1 rounded-lg border border-transparent px-2.5 py-1.5 text-sm text-slate-500 dark:text-slate-400">50% do valor</p>
                              ) : isLast ? (
                                <p className="mt-1 rounded-lg border border-transparent px-2.5 py-1.5 text-sm text-slate-500 dark:text-slate-400">R$ 0,00 (isento)</p>
                              ) : (
                                <AffixInput name={`platform_MERCADO_LIVRE_tier${i}_feeFixed`} defaultValue={tiers[idx]?.feeFixed ?? 0} prefix="R$" />
                              )}
                            </Field>
                          </div>
                        )
                      })}
                    </div>

                    <p className="mt-4 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                      Vendedor com menos de 10 vendas ainda não tem reputação — nesse período, o Mercado Livre usa a mesma tabela de frete subsidiado da reputação verde. Isso não muda a comissão nem o custo fixo cadastrados acima, então não existe um campo separado para conta nova.
                    </p>

                    <input type="hidden" name={`platform_${kind}_avgFreight`} value={p.avgFreight} />
                  </div>
                )
              }
              return null
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

      <Card title="Estoque" description="Limiares usados em acessórios, insumos e produtos acabados.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Limiar de estoque baixo">
            <AffixInput name="stockLowThresholdPercent" defaultValue={toPercentDisplay(settings.stockLowThresholdPercent)} suffix="%" max="100" />
          </Field>
          <Field label="Limiar de estoque crítico">
            <AffixInput name="stockCriticalThresholdPercent" defaultValue={toPercentDisplay(settings.stockCriticalThresholdPercent)} suffix="%" max="100" />
          </Field>
          <Field label="Pouco estoque de produto acabado (Meu Estoque)">
            <AffixInput name="productLowStockThreshold" defaultValue={settings.productLowStockThreshold} suffix="un" step="1" />
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
                  ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
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
                className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            <span className="text-xs text-slate-400 dark:text-slate-500">Ex: 50 arredonda para R$ 19,50, R$ 24,50 etc.</span>
          </div>
        )}
      </Card>

      {/* Item 8 do brief: botão fixo no rodapé da área rolável (<main
          overflow-y-auto> em AppLayoutClient), sempre visível sem precisar
          rolar de volta ao fim da tela toda vez que um campo é ajustado.
          Bug "botão flutuando por cima do conteúdo": fundo translúcido
          (bg-white/95 + backdrop-blur) deixava a última linha da tabela de
          Marketplaces "vazar" por trás da barra quando o scroll chegava no
          fim -- vira opaco (sem blur) e o form ganha mais respiro embaixo
          (pb-36) pra nunca sobrar conteúdo bem debaixo da barra. */}
      <div className="sticky bottom-0 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-4px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900">
        <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>
        {message && <p className="text-sm text-slate-600 dark:text-slate-400">{message}</p>}
      </div>
    </form>
  )
}
