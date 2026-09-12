'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmAssembly, type AssemblyPartStatus, type AssemblyComponentStatus, type AssemblyResourceRequirement } from '@/actions/assembly'
import { SubmitButton } from '@/components/SubmitButton'
import { ComponentCategoryCard, type ComponentOption, type ComponentRow } from './ComponentCategoryCard'
import { ComboSelect, type ComboOption } from './ComboSelect'

// Melhoria "Produto-como-componente": peça (ProductPart) e componente
// (outro Product usado como ingrediente) compartilham a mesma UX de
// "escolher cor" -- unifica os dois num shape só (`key` = partId OU
// componentProductId, sem conflito de namespace) pra não duplicar toda a
// seção "Cor de cada peça nesta leva".
interface ColorSelectable {
  key: string
  name: string
  quantityPerUnit: number
  colorOptions: AssemblyPartStatus['colorOptions']
  maxUnits: number
}

function toSelectables(parts: AssemblyPartStatus[], components: AssemblyComponentStatus[]): ColorSelectable[] {
  return [
    ...parts.map((p): ColorSelectable => ({ key: p.partId, name: p.name, quantityPerUnit: p.quantityPerUnit, colorOptions: p.colorOptions, maxUnits: p.maxUnitsFromThisPart })),
    ...components.map((c): ColorSelectable => ({ key: c.componentProductId, name: c.name, quantityPerUnit: c.quantityPerUnit, colorOptions: c.colorOptions, maxUnits: c.maxUnitsFromThisComponent })),
  ]
}

// Melhoria "Acessório com cor variável": mesmo shape/UX de escolha de cor
// de peça/componente, agora pra Acessório com "irmãos" de cor no
// catálogo -- mas NUNCA entra em `effectiveMax` (falta de acessório não
// bloqueia a montagem, só peça/componente bloqueiam) -- por isso é uma
// lista SEPARADA de `toSelectables`, só usada pra render + preencher
// colorChoicesJson, nunca pro cálculo de quantidade máxima. `maxUnits`
// fica 0 (não lido em lugar nenhum pra este caso).
function toAccessoryColorSelectables(accessoryRequirements: AssemblyResourceRequirement[]): ColorSelectable[] {
  return accessoryRequirements
    .filter((a) => a.colorOptions)
    .map((a): ColorSelectable => ({ key: a.id, name: a.name, quantityPerUnit: a.quantityPerUnit, colorOptions: a.colorOptions, maxUnits: 0 }))
}

// Ajuste "cor na montagem": pra cada peça/componente de cor variável
// (colorOptions não nulo), a montagem precisa escolher QUAL cor está
// sendo consumida nesta leva -- a quantidade máxima que dá pra montar
// depende de qual cor foi escolhida, então recalcula a cada mudança de
// seleção.
function defaultColorChoice(item: ColorSelectable): string {
  if (!item.colorOptions || item.colorOptions.length === 0) return ''
  const best = item.colorOptions.reduce((a, b) => (b.available > a.available ? b : a))
  return best.key
}

function toRows(requirements: AssemblyResourceRequirement[]): ComponentRow[] {
  return requirements.map((r) => ({ id: r.id, quantityPerUnit: String(r.quantityPerUnit), defaultQuantityPerUnit: r.quantityPerUnit }))
}

function toComboOptions(item: ColorSelectable): ComboOption[] {
  return (item.colorOptions ?? []).map((o) => ({ key: o.key, label: o.label, colorHex: o.colorHex, available: o.available }))
}

const STEPS = [
  { n: 1, label: 'Peças & cores' },
  { n: 2, label: 'Acessórios & insumos' },
  { n: 3, label: 'Revisar & confirmar' },
] as const

function StepTabs({ step, onChange }: { step: number; onChange: (n: 1 | 2 | 3) => void }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
      {STEPS.map((s) => (
        <button
          key={s.n}
          type="button"
          onClick={() => onChange(s.n)}
          className={`flex items-center gap-2 border-b-2 px-1 pb-2 pt-1 text-sm font-medium transition-colors ${
            step === s.n
              ? 'border-violet-600 text-slate-900 dark:border-violet-500 dark:text-slate-100'
              : 'border-transparent text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
          } ${s.n > 1 ? 'ml-4' : ''}`}
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              step === s.n
                ? 'bg-violet-600 text-white dark:bg-violet-500 dark:text-slate-950'
                : step > s.n
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {s.n}
          </span>
          {s.label}
        </button>
      ))}
    </div>
  )
}

// Card de UMA peça/componente/acessório-com-cor: nome + qtd/unidade + o
// seletor de cor (com estoque) juntos no mesmo lugar. Bug "montei o
// produto errado": antes a tabela de "Peça/Qtd/Produzido/Disponível" e o
// <select> de cor real ficavam em seções bem distantes da modal --
// juntar os dois aqui elimina essa distância.
function ComboCard({ item, value, onChange }: { item: ColorSelectable; value: string; onChange: (key: string) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</span>
        <span className="shrink-0 whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">{item.quantityPerUnit}× por unidade</span>
      </div>
      <ComboSelect options={toComboOptions(item)} value={value} onChange={onChange} />
    </div>
  )
}

export function ConfirmAssemblyForm({
  productId,
  isComposite,
  parts,
  components,
  accessoryRequirements,
  supplyRequirements,
  packagingRequirements,
  allAccessories,
  allSupplies,
  allPackaging,
}: {
  productId: string
  isComposite: boolean
  parts: AssemblyPartStatus[]
  components: AssemblyComponentStatus[]
  accessoryRequirements: AssemblyResourceRequirement[]
  supplyRequirements: AssemblyResourceRequirement[]
  packagingRequirements: AssemblyResourceRequirement[]
  allAccessories: ComponentOption[]
  allSupplies: ComponentOption[]
  allPackaging: ComponentOption[]
}) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const selectables = useMemo(() => toSelectables(parts, components), [parts, components])
  const accessoryColorSelectables = useMemo(() => toAccessoryColorSelectables(accessoryRequirements), [accessoryRequirements])
  const colorSelectables = useMemo(
    () => [...selectables.filter((s) => s.colorOptions), ...accessoryColorSelectables],
    [selectables, accessoryColorSelectables],
  )
  const [colorChoices, setColorChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(colorSelectables.map((s) => [s.key, defaultColorChoice(s)])),
  )
  // Acessório com cor variável (colorOptions não nulo) sai da lista livre
  // de baixo -- passa a ser escolhido só pelo seletor de cor acima, não
  // mais editável/trocável linha a linha aqui.
  const [accessoryRows, setAccessoryRows] = useState<ComponentRow[]>(() => toRows(accessoryRequirements.filter((r) => !r.colorOptions)))
  const [supplyRows, setSupplyRows] = useState<ComponentRow[]>(() => toRows(supplyRequirements))
  // Embalagem §5: mostrada por completude/visibilidade, NUNCA submetida ao
  // confirmAssembly (continua consumida só na Venda) -- estado só existe
  // aqui pra alimentar o próprio ComponentCategoryCard (readOnly).
  const packagingRows = useMemo(() => toRows(packagingRequirements), [packagingRequirements])

  // Bug fix ("montei o produto errado"): o teto de unidades usado a
  // circular no servidor (maxUnitsFromThisPart/maxUnitsFromThisComponent)
  // é o MELHOR CASO possível (a cor com mais estoque, ver actions/
  // assembly.ts), não a cor que a pessoa efetivamente escolheu aqui --
  // usar aquele número direto deixava o campo de quantidade aceitar um
  // valor que parecia certo mas não era pra COR ESCOLHIDA, e o erro só
  // aparecia (se aparecesse) na mensagem genérica do servidor depois de
  // confirmar. Recalcula ao vivo a partir de colorChoices, sempre em
  // sincronia com o que a ficha lateral e os cards mostram.
  const effectiveMax = useMemo(() => {
    const limits = selectables.map((s) => {
      if (!s.colorOptions || s.colorOptions.length === 0) return s.maxUnits
      const chosen = s.colorOptions.find((o) => o.key === colorChoices[s.key])
      return chosen ? Math.floor(chosen.available / s.quantityPerUnit) : 0
    })
    return limits.length === 0 ? 0 : Math.max(0, Math.min(...limits))
  }, [selectables, colorChoices])

  // Mesmo raciocínio acima: peça/componente sem estoque na cor ATUALMENTE
  // escolhida (ou nunca produzido) -- ao vivo, não a foto do carregamento
  // inicial da modal.
  const blockingItems = useMemo(() => selectables.filter((s) => {
    if (s.colorOptions && s.colorOptions.length > 0) {
      const chosen = s.colorOptions.find((o) => o.key === colorChoices[s.key])
      return !chosen || chosen.available <= 0
    }
    return s.maxUnits <= 0
  }), [selectables, colorChoices])

  const [quantity, setQuantity] = useState(String(effectiveMax))

  // Melhoria "Montagem" §7: quantidade sempre parte pré-preenchida do
  // máximo permitido -- reajusta automaticamente quando o teto muda (o
  // campo continua livremente editável depois disso).
  useEffect(() => {
    setQuantity(String(effectiveMax))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o teto muda, não a cada keystroke do próprio campo
  }, [effectiveMax])

  const quantityNum = parseInt(quantity, 10) || 0

  async function action(formData: FormData) {
    if (colorSelectables.some((s) => !colorChoices[s.key])) {
      alert('Selecione a cor de cada peça/componente antes de confirmar.')
      return
    }
    if ([...accessoryRows, ...supplyRows].some((r) => !r.id)) {
      alert('Selecione o insumo/acessório de cada linha, ou remova a linha vazia.')
      return
    }
    formData.set('colorChoicesJson', JSON.stringify(colorChoices))
    // Acessório com cor variável não está mais em accessoryRows (saiu da
    // lista livre) -- entra aqui resolvido pela cor escolhida acima, id
    // efetivamente consumido é o da cor escolhida, não o da ficha técnica.
    const colorVariableAccessoryUsages = accessoryColorSelectables.map((s) => ({ id: colorChoices[s.key], quantityPerUnit: s.quantityPerUnit }))
    formData.set('accessoryUsagesJson', JSON.stringify([
      ...accessoryRows.map((r) => ({ id: r.id, quantityPerUnit: parseFloat(r.quantityPerUnit) || 0 })),
      ...colorVariableAccessoryUsages,
    ]))
    formData.set('supplyUsagesJson', JSON.stringify(supplyRows.map((r) => ({ id: r.id, quantityPerUnit: parseFloat(r.quantityPerUnit) || 0 }))))
    const result = await confirmAssembly(formData)
    if (result.success) {
      router.refresh()
    } else {
      alert(result.error)
    }
  }

  const partItems = selectables.slice(0, parts.length)
  const componentItems = selectables.slice(parts.length)

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 space-y-4">
        <StepTabs step={step} onChange={setStep} />

        {step === 1 && (
          <div className="space-y-4">
            <div className="tk-panel p-4">
              <h2 className="mb-1 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                {isComposite ? 'Peças impressas' : 'Impressão'}
              </h2>
              <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Cada card já mostra a peça e a cor/estoque juntos.</p>
              <div className="space-y-2">
                {partItems.map((item) => (
                  <ComboCard
                    key={item.key}
                    item={item}
                    value={colorChoices[item.key] ?? ''}
                    onChange={(key) => setColorChoices((prev) => ({ ...prev, [item.key]: key }))}
                  />
                ))}
              </div>
            </div>

            {componentItems.length > 0 && (
              <div className="tk-panel p-4">
                <h2 className="mb-1 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Componentes</h2>
                <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Cores sem estoque aparecem apagadas e não podem ser selecionadas.</p>
                <div className="space-y-2">
                  {componentItems.map((item) => (
                    <ComboCard
                      key={item.key}
                      item={item}
                      value={colorChoices[item.key] ?? ''}
                      onChange={(key) => setColorChoices((prev) => ({ ...prev, [item.key]: key }))}
                    />
                  ))}
                </div>
              </div>
            )}

            {accessoryColorSelectables.length > 0 && (
              <div className="tk-panel p-4">
                <h2 className="mb-1 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Acessórios (cor variável)</h2>
                <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Falta desse acessório não impede montar, mas escolha a cor certa mesmo assim.</p>
                <div className="space-y-2">
                  {accessoryColorSelectables.map((item) => (
                    <ComboCard
                      key={item.key}
                      item={item}
                      value={colorChoices[item.key] ?? ''}
                      onChange={(key) => setColorChoices((prev) => ({ ...prev, [item.key]: key }))}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" onClick={() => setStep(2)} className="tk-btn-primary">Continuar</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <ComponentCategoryCard label="Acessórios" rows={accessoryRows} onChange={setAccessoryRows} options={allAccessories} />
            <ComponentCategoryCard label="Insumos" rows={supplyRows} onChange={setSupplyRows} options={allSupplies} />
            <ComponentCategoryCard label="Embalagem" rows={packagingRows} onChange={() => {}} options={allPackaging} readOnly />
            <div className="flex justify-between">
              <button type="button" onClick={() => setStep(1)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:underline dark:text-slate-400">Voltar</button>
              <button type="button" onClick={() => setStep(3)} className="tk-btn-primary">Continuar</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="tk-panel p-4">
              <h2 className="mb-1 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Confira antes de montar</h2>
              <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Essa é a combinação exata que vai ser produzida.</p>
              <div className="flex flex-wrap gap-2">
                {colorSelectables.map((item) => {
                  const chosen = item.colorOptions?.find((o) => o.key === colorChoices[item.key]) ?? null
                  return (
                    <span key={item.key} className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1.5 pr-3 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                      {chosen?.colorHex ? (
                        <span style={{ background: chosen.colorHex }} className="inline-block h-4 w-4 shrink-0 rounded-full border border-slate-300/50 dark:border-slate-600/50" />
                      ) : (
                        <span className="inline-block h-4 w-4 shrink-0 rounded-full border border-dashed border-slate-300 dark:border-slate-600" />
                      )}
                      <span><span className="font-semibold">{item.name}</span> — {chosen?.label ?? '—'}</span>
                    </span>
                  )
                })}
              </div>
            </div>

            <form action={action} className="tk-panel grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              <input type="hidden" name="productId" value={productId} />
              <label className="text-sm">
                Quantidade a montar
                <input
                  name="quantity"
                  type="number"
                  step="1"
                  min="1"
                  max={effectiveMax}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="tk-input-full"
                  required
                  disabled={effectiveMax <= 0}
                />
              </label>
              <label className="text-sm">
                Observações (opcional)
                <input name="notes" className="tk-input-full" />
              </label>
              <div className="col-span-full flex items-center justify-between">
                <button type="button" onClick={() => setStep(2)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:underline dark:text-slate-400">Voltar</button>
                <SubmitButton pendingLabel="Montando…" disabled={effectiveMax <= 0}>
                  Confirmar montagem
                </SubmitButton>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Ficha de montagem: sempre visível, atualiza a cada escolha de cor
          -- fica sticky dentro do próprio scroll da modal (AssemblyDetailModal),
          não da janela. Bug "montei o produto errado": antes o aviso de
          estoque insuficiente vinha de status.parts (a foto de quando a
          modal abriu), não da cor que a pessoa realmente escolheu -- esta
          ficha só existe pra nunca mais divergir do que está selecionado. */}
      <aside className="w-full shrink-0 lg:sticky lg:top-0 lg:w-72">
        <div className="tk-panel p-4">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Ficha de montagem</h2>
          <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Atualiza a cada escolha de cor</p>

          <div className={`mb-3 rounded-lg border p-3 ${effectiveMax > 0 ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-500/10' : 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-500/10'}`}>
            <p className={`font-display text-2xl font-bold tabular-nums ${effectiveMax > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{effectiveMax}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">unidade{effectiveMax === 1 ? '' : 's'} possíve{effectiveMax === 1 ? 'l' : 'is'} com a combinação atual</p>
          </div>

          <div className="space-y-1.5">
            {[...selectables, ...accessoryColorSelectables].map((item) => {
              const chosen = item.colorOptions?.find((o) => o.key === colorChoices[item.key]) ?? null
              const bad = item.colorOptions ? (!chosen || chosen.available <= 0) : item.maxUnits <= 0
              return (
                <div key={item.key} className="flex items-center gap-2 text-xs">
                  {chosen?.colorHex ? (
                    <span style={{ background: chosen.colorHex }} className="inline-block h-3.5 w-3.5 shrink-0 rounded-md border border-slate-300/50 dark:border-slate-600/50" />
                  ) : (
                    <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-md border border-dashed border-slate-300 dark:border-slate-600" />
                  )}
                  <span className="flex-1 truncate text-slate-500 dark:text-slate-400">{item.name}</span>
                  <span className={`shrink-0 truncate font-medium ${bad ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                    {chosen?.label ?? (item.colorOptions ? '—' : 'ok')}
                  </span>
                </div>
              )
            })}
          </div>

          {blockingItems.length > 0 ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
              ⚠ {blockingItems.map((i) => i.name).join(', ')} sem estoque na cor escolhida — essa combinação não pode ser montada.
            </p>
          ) : effectiveMax > 0 && quantityNum > effectiveMax ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
              ⚠ Estoque só cobre {effectiveMax} unidade(s), menos que a quantidade pedida ({quantityNum}).
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
