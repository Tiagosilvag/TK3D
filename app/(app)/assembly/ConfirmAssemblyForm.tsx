'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmAssembly, type AssemblyPartStatus, type AssemblyComponentStatus, type AssemblyResourceRequirement } from '@/actions/assembly'
import { SubmitButton } from '@/components/SubmitButton'
import { ComponentCategoryCard, type ComponentOption, type ComponentRow } from './ComponentCategoryCard'

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

export function ConfirmAssemblyForm({
  productId,
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

  // Melhoria "Montagem" §4/§6, "Produto-como-componente": só peça/
  // componente (via `maxUnits`, que já soma entre combos de cor) trava
  // quanto dá pra montar -- falta de acessório/insumo não entra mais neste
  // cálculo (só avisa, nunca bloqueia).
  const effectiveMax = useMemo(() => {
    const limits = selectables.map((s) => s.maxUnits)
    return limits.length === 0 ? 0 : Math.max(0, Math.min(...limits))
  }, [selectables])

  const [quantity, setQuantity] = useState(String(effectiveMax))

  // Melhoria "Montagem" §7: quantidade sempre parte pré-preenchida do
  // máximo permitido -- reajusta automaticamente quando o teto muda (o
  // campo continua livremente editável depois disso).
  useEffect(() => {
    setQuantity(String(effectiveMax))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o teto muda, não a cada keystroke do próprio campo
  }, [effectiveMax])

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

  return (
    <>
      {colorSelectables.length > 0 && (
        <div className="tk-panel p-4">
          <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Cor de cada peça/componente/acessório nesta leva</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {colorSelectables.map((item) => (
              <label key={item.key} className="text-sm">
                {item.name}
                <select
                  value={colorChoices[item.key] ?? ''}
                  onChange={(e) => setColorChoices((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  className="tk-input-full"
                  required
                >
                  <option value="" disabled>Selecione a cor</option>
                  {item.colorOptions!.map((o) => (
                    <option key={o.key} value={o.key} disabled={o.available <= 0}>
                      {o.label} ({o.available} {o.available === 1 ? 'disponível' : 'disponíveis'})
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <ComponentCategoryCard label="Acessórios" rows={accessoryRows} onChange={setAccessoryRows} options={allAccessories} />
      <ComponentCategoryCard label="Insumos" rows={supplyRows} onChange={setSupplyRows} options={allSupplies} />
      <ComponentCategoryCard label="Embalagem" rows={packagingRows} onChange={() => {}} options={allPackaging} readOnly />

      <form action={action} className="tk-panel grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <input type="hidden" name="productId" value={productId} />
        <h2 className="col-span-full font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Confirmar montagem</h2>
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
        <div className="col-span-full mt-1">
          <SubmitButton pendingLabel="Montando…" disabled={effectiveMax <= 0}>
            Confirmar montagem
          </SubmitButton>
        </div>
      </form>
    </>
  )
}
