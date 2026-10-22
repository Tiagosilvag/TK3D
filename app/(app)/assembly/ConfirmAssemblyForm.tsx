'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { confirmAssembly, type AssemblyPartStatus, type AssemblyComponentStatus, type AssemblyResourceRequirement } from '@/actions/assembly'
import { SubmitButton } from '@/components/SubmitButton'
import { ComponentCategoryCard, optionLabel, type ComponentOption, type ComponentRow } from './ComponentCategoryCard'
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
// Encomenda com variação personalizada: quando a montagem vem de um
// pedido específico (presetColorChoices, decodificado de
// ?presetColorComboKey= por assembly/page.tsx), a combinação que o
// PEDIDO pediu tem prioridade sobre a heurística de sempre -- só cai pra
// ela se a peça não tiver preset (produto sem pedido em aberto) ou o
// preset não for uma opção válida pra essa peça (ficha técnica mudou
// desde que o pedido foi criado).
function defaultColorChoice(item: ColorSelectable, presetColorChoices: Record<string, string> | null): string {
  if (!item.colorOptions || item.colorOptions.length === 0) return ''
  const preset = presetColorChoices?.[item.key]
  if (preset && item.colorOptions.some((o) => o.key === preset)) return preset
  // Bug "prévia diz Prata mas pré-preenche Dourado": pra Acessório
  // (item.key = o próprio id do acessório registrado na ficha técnica --
  // nunca bate com nenhuma chave de combo de peça/componente, então esse
  // branch é inofensivo pra eles), o padrão deve ser a cor REGISTRADA, não
  // simplesmente a de maior estoque entre os "irmãos" -- só cai pro
  // "maior estoque" se a cor registrada estiver zerada.
  const registered = item.colorOptions.find((o) => o.key === item.key)
  if (registered && registered.available > 0) return registered.key
  const best = item.colorOptions.reduce((a, b) => (b.available > a.available ? b : a))
  return best.key
}

function toRows(requirements: AssemblyResourceRequirement[]): ComponentRow[] {
  return requirements.map((r) => ({ id: r.id, quantityPerUnit: String(r.quantityPerUnit), defaultQuantityPerUnit: r.quantityPerUnit }))
}

function toComboOptions(item: ColorSelectable): ComboOption[] {
  return (item.colorOptions ?? []).map((o) => ({ key: o.key, label: o.label, colorHex: o.colorHex, available: o.available }))
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
  allAccessories,
  allSupplies,
  presetColorChoices,
  desiredQuantity,
}: {
  productId: string
  isComposite: boolean
  parts: AssemblyPartStatus[]
  components: AssemblyComponentStatus[]
  accessoryRequirements: AssemblyResourceRequirement[]
  supplyRequirements: AssemblyResourceRequirement[]
  allAccessories: ComponentOption[]
  allSupplies: ComponentOption[]
  // Encomenda com variação personalizada: combinação de cor que um
  // pedido específico precisa (vinda de AssemblyDemandPanel), usada só
  // como valor INICIAL de colorChoices -- o usuário continua livre pra
  // trocar depois, igual qualquer outra pré-seleção.
  presetColorChoices?: Record<string, string> | null
  // Quantidade que o pedido ainda precisa (?qty=): a quantidade inicial é o
  // menor entre ela e o que dá pra montar.
  desiredQuantity?: number | null
}) {
  const router = useRouter()
  // Melhoria "aviso de sucesso": fechar a modal direto (fix anterior) tirava
  // a tela debaixo do usuário rápido demais pra notar que a montagem
  // realmente aconteceu -- mostra "Montagem confirmada!" por um instante
  // ANTES de navegar pra /assembly (mesmo redirecionamento de antes, só
  // com um respiro visual no meio).
  const [confirmed, setConfirmed] = useState(false)
  const selectables = useMemo(() => toSelectables(parts, components), [parts, components])
  const accessoryColorSelectables = useMemo(() => toAccessoryColorSelectables(accessoryRequirements), [accessoryRequirements])
  const colorSelectables = useMemo(
    () => [...selectables.filter((s) => s.colorOptions), ...accessoryColorSelectables],
    [selectables, accessoryColorSelectables],
  )
  const [colorChoices, setColorChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(colorSelectables.map((s) => [s.key, defaultColorChoice(s, presetColorChoices ?? null)])),
  )
  // Acessório com cor variável (colorOptions não nulo) sai da lista livre
  // de baixo -- passa a ser escolhido só pelo seletor de cor acima, não
  // mais editável/trocável linha a linha aqui.
  const [accessoryRows, setAccessoryRows] = useState<ComponentRow[]>(() => toRows(accessoryRequirements.filter((r) => !r.colorOptions)))
  const [supplyRows, setSupplyRows] = useState<ComponentRow[]>(() => toRows(supplyRequirements))
  // Bug "acessório não aparece na montagem, resumindo no final": Acessórios/
  // Insumos SEM cor variável (accessoryRows/supplyRows) nunca entravam no
  // resumo do passo 3 "Confira antes de montar" -- só os chips de cor
  // (colorSelectables), então um acessório de quantidade fixa (ex.: ELO)
  // ficava invisível na revisão final mesmo sendo decrementado do estoque
  // ao confirmar. Mapa id→opção pra resolver nome/unidade de exibição.
  const accessoryById = useMemo(() => new Map(allAccessories.map((a) => [a.id, a])), [allAccessories])
  const supplyById = useMemo(() => new Map(allSupplies.map((s) => [s.id, s])), [allSupplies])
  // Embalagem §5: mostrada por completude/visibilidade, NUNCA submetida ao
  // confirmAssembly (continua consumida só na Venda) -- estado só existe
  // aqui pra alimentar o próprio ComponentCategoryCard (readOnly).

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

  const initialQuantity = (max: number) => String(desiredQuantity && desiredQuantity > 0 ? Math.min(desiredQuantity, max) : max)
  const [quantity, setQuantity] = useState(initialQuantity(effectiveMax))

  // Melhoria "Montagem" §7: quantidade sempre parte pré-preenchida do
  // máximo permitido -- reajusta automaticamente quando o teto muda (o
  // campo continua livremente editável depois disso).
  useEffect(() => {
    setQuantity(initialQuantity(effectiveMax))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o teto muda, não a cada keystroke do próprio campo
  }, [effectiveMax])

  const quantityNum = parseInt(quantity, 10) || 0

  // Ficha ao vivo: quantas unidades cada peça/componente cobre COM A COR
  // ESCOLHIDA; a(s) que limita(m) o total fica(m) destacada(s).
  const coverage = selectables.map((item) => {
    const chosen = item.colorOptions?.find((o) => o.key === colorChoices[item.key]) ?? null
    const covers = item.colorOptions && item.colorOptions.length > 0
      ? (chosen && item.quantityPerUnit > 0 ? Math.floor(chosen.available / item.quantityPerUnit) : 0)
      : item.maxUnits
    return { item, chosen, covers }
  })
  const wantedUnits = Math.max(quantityNum, 1)
  const missingForWanted = coverage.filter((c) => c.covers < wantedUnits).map((c) => ({ name: c.item.name, units: wantedUnits - c.covers }))

  // Acessório/insumo faltando NÃO impede montar -- só avisa o quanto falta.
  const stockWarnings: string[] = []
  for (const r of accessoryRows) {
    const option = accessoryById.get(r.id)
    const need = (parseFloat(r.quantityPerUnit) || 0) * quantityNum
    if (option && need > option.available) stockWarnings.push(`${optionLabel(option)}: faltam ${+(need - option.available).toFixed(2)}`)
  }
  for (const s of accessoryColorSelectables) {
    const option = accessoryById.get(colorChoices[s.key])
    const need = s.quantityPerUnit * quantityNum
    if (option && need > option.available) stockWarnings.push(`${optionLabel(option)}: faltam ${+(need - option.available).toFixed(2)}`)
  }
  for (const r of supplyRows) {
    const option = supplyById.get(r.id)
    const need = (parseFloat(r.quantityPerUnit) || 0) * quantityNum
    if (option && need > option.available) stockWarnings.push(`${optionLabel(option)}: faltam ${+(need - option.available).toFixed(2)}`)
  }

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
      // Bug "sem confirmação de sucesso": router.refresh() só atualizava os
      // números no fundo (ex.: "sem estoque" quando a última unidade acabou
      // de ser consumida) -- a modal continuava aberta na mesma tela,
      // exatamente como estava, sem NENHUM sinal de que a montagem tinha
      // sido registrada. Mostra "Montagem confirmada!" por 1,2s -- tempo
      // suficiente pra notar -- e só então navega pra /assembly (mesmo
      // redirecionamento de antes: AssemblyDetailModal fecha sozinha ao
      // voltar sem ?productId=, e a lista geral já chega com os números
      // atualizados via revalidatePath dentro de confirmAssembly).
      setConfirmed(true)
      setTimeout(() => router.push('/assembly'), 1200)
    } else {
      alert(result.error)
    }
  }

  const partItems = selectables.slice(0, parts.length)
  const componentItems = selectables.slice(parts.length)

  if (confirmed) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-7 w-7" aria-hidden>
            <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
          </svg>
        </span>
        <p className="font-display text-base font-semibold text-emerald-600 dark:text-emerald-400">Montagem confirmada!</p>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <input type="hidden" name="productId" value={productId} />
      <div className="min-w-0 flex-1 space-y-4">
        <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">
          {presetColorChoices
            ? <><b>Preenchido a partir do pedido.</b> Tudo aqui é sugestão e pode ser mudado.</>
            : <><b>Preenchido com as combinações de maior estoque.</b> Tudo aqui é sugestão e pode ser mudado.</>}
        </p>

        <div className="tk-panel p-4">
          <h2 className="mb-1 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isComposite ? 'Peças impressas' : 'Impressão'}
          </h2>
          <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Cada peça mostra as combinações de cor e quanto tem de cada uma. Combinação sem estoque pode ser escolhida, mas não monta.</p>
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
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Falta de acessório não impede montar, mas escolha a cor certa mesmo assim.</p>
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

        <ComponentCategoryCard label="Acessórios" rows={accessoryRows} onChange={setAccessoryRows} options={allAccessories} />
        <ComponentCategoryCard label="Insumos" rows={supplyRows} onChange={setSupplyRows} options={allSupplies} />

        {/* Rodapé fixo na rolagem da modal: quantidade (já selecionada, Enter
            confirma), observações e as duas saídas. */}
        <div className="tk-panel sticky bottom-0 z-10 grid grid-cols-2 items-end gap-3 p-4 shadow-lg md:grid-cols-[8rem_1fr_auto]">
          <label className="text-sm">
            Quantidade a montar
            <input
              name="quantity"
              type="number"
              step="1"
              min={1}
              max={Math.max(effectiveMax, 1)}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onFocus={(e) => e.target.select()}
              autoFocus
              className="tk-input-full"
              required
              disabled={effectiveMax <= 0}
            />
            <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">máx. {effectiveMax}</span>
          </label>
          <label className="col-span-2 text-sm md:col-span-1">
            Observações (opcional)
            <input name="notes" className="tk-input-full" />
          </label>
          <div className="col-span-2 flex flex-wrap items-center justify-end gap-2 md:col-span-1">
            {missingForWanted.length > 0 && (
              <Link href="/production" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                → Ir para Produção
              </Link>
            )}
            <SubmitButton pendingLabel="Montando…" disabled={effectiveMax <= 0 || quantityNum < 1 || quantityNum > effectiveMax}>
              Confirmar montagem
            </SubmitButton>
          </div>
        </div>
      </div>

      {/* Ficha de montagem: sempre visível, atualiza a cada escolha. */}
      <aside className="w-full shrink-0 lg:sticky lg:top-0 lg:w-72">
        <div className="tk-panel p-4">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Ficha de montagem</h2>
          <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Atualiza a cada mudança</p>

          <div className={`mb-3 rounded-lg border p-3 ${effectiveMax > 0 ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-500/10' : 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-500/10'}`}>
            <p className={`font-display text-3xl font-bold tabular-nums ${effectiveMax > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{effectiveMax}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">unidade{effectiveMax === 1 ? '' : 's'} possíve{effectiveMax === 1 ? 'l' : 'is'} com a combinação atual</p>
          </div>

          <div className="space-y-2">
            {coverage.map(({ item, chosen, covers }) => {
              const limits = covers === effectiveMax && coverage.length > 1
              return (
                <div key={item.key} className="flex items-start gap-2 text-xs">
                  {chosen?.colorHex ? (
                    <span style={{ background: chosen.colorHex }} className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300/50 dark:border-slate-600/50" />
                  ) : (
                    <span className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-dashed border-slate-300 dark:border-slate-600" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{item.name}</span>
                    <span className="block break-words text-slate-500 dark:text-slate-400">{chosen?.label ?? (item.colorOptions ? 'sem combinação' : '')}</span>
                  </span>
                  <span className={`shrink-0 text-right ${covers <= 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>
                    {chosen ? `${chosen.available} disp.` : ''}
                    <span className="block">cobre {covers} un.{limits && <b className="ml-1 text-amber-600 dark:text-amber-400">limita</b>}</span>
                  </span>
                </div>
              )
            })}
            {accessoryColorSelectables.map((item) => {
              const chosen = item.colorOptions?.find((o) => o.key === colorChoices[item.key]) ?? null
              return (
                <div key={item.key} className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span style={chosen?.colorHex ? { background: chosen.colorHex } : undefined} className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300/50 dark:border-slate-600/50" />
                  <span className="min-w-0 flex-1"><span className="font-semibold text-slate-800 dark:text-slate-200">{item.name}</span> · {chosen?.label ?? '—'}</span>
                </div>
              )
            })}
          </div>

          {stockWarnings.length > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              ⚠ {stockWarnings.join(' · ')} <span className="opacity-80">(não impede montar)</span>
            </p>
          )}

          {quantityNum > effectiveMax && missingForWanted.length > 0 ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
              Só dá para montar {effectiveMax} agora. Faltam: {missingForWanted.map((m) => `${m.name} (${m.units})`).join(', ')}.
            </p>
          ) : blockingItems.length > 0 ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
              ⚠ {blockingItems.map((i) => i.name).join(', ')} sem estoque na combinação escolhida.
            </p>
          ) : null}
        </div>
      </aside>
    </form>
  )
}
