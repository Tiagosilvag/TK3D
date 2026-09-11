'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmAssembly, type AssemblyPartStatus, type AssemblyResourceRequirement } from '@/actions/assembly'
import { SubmitButton } from '@/components/SubmitButton'
import { ComponentCategoryCard, type ComponentOption, type ComponentRow } from './ComponentCategoryCard'

// Ajuste "cor na montagem": pra cada peça de cor variável (colorOptions
// não nulo), a montagem precisa escolher QUAL cor está sendo consumida
// nesta leva -- a quantidade máxima que dá pra montar depende de qual cor
// foi escolhida em cada peça, então recalcula a cada mudança de seleção.
function defaultColorChoice(part: AssemblyPartStatus): string {
  if (!part.colorOptions || part.colorOptions.length === 0) return ''
  const best = part.colorOptions.reduce((a, b) => (b.available > a.available ? b : a))
  return best.key
}

function toRows(requirements: AssemblyResourceRequirement[]): ComponentRow[] {
  return requirements.map((r) => ({ id: r.id, quantityPerUnit: String(r.quantityPerUnit), defaultQuantityPerUnit: r.quantityPerUnit }))
}

export function ConfirmAssemblyForm({
  productId,
  parts,
  accessoryRequirements,
  supplyRequirements,
  packagingRequirements,
  allAccessories,
  allSupplies,
  allPackaging,
}: {
  productId: string
  parts: AssemblyPartStatus[]
  accessoryRequirements: AssemblyResourceRequirement[]
  supplyRequirements: AssemblyResourceRequirement[]
  packagingRequirements: AssemblyResourceRequirement[]
  allAccessories: ComponentOption[]
  allSupplies: ComponentOption[]
  allPackaging: ComponentOption[]
}) {
  const router = useRouter()
  const colorParts = useMemo(() => parts.filter((p) => p.colorOptions), [parts])
  const [colorChoices, setColorChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(colorParts.map((p) => [p.partId, defaultColorChoice(p)])),
  )
  const [accessoryRows, setAccessoryRows] = useState<ComponentRow[]>(() => toRows(accessoryRequirements))
  const [supplyRows, setSupplyRows] = useState<ComponentRow[]>(() => toRows(supplyRequirements))
  // Embalagem §5: mostrada por completude/visibilidade, NUNCA submetida ao
  // confirmAssembly (continua consumida só na Venda) -- estado só existe
  // aqui pra alimentar o próprio ComponentCategoryCard (readOnly).
  const packagingRows = useMemo(() => toRows(packagingRequirements), [packagingRequirements])

  // Melhoria "Montagem" §4/§6: só a peça (via cor escolhida) trava quanto
  // dá pra montar -- falta de acessório/insumo não entra mais neste
  // cálculo (era isso antes; agora só avisa, nunca bloqueia).
  const effectiveMax = useMemo(() => {
    const partLimits = parts.map((part) => {
      if (!part.colorOptions) return part.maxUnitsFromThisPart
      const chosen = part.colorOptions.find((o) => o.key === colorChoices[part.partId])
      return chosen ? Math.floor(chosen.available / part.quantityPerUnit) : 0
    })
    return partLimits.length === 0 ? 0 : Math.max(0, Math.min(...partLimits))
  }, [parts, colorChoices])

  const [quantity, setQuantity] = useState(String(effectiveMax))

  // Melhoria "Montagem" §7: quantidade sempre parte pré-preenchida do
  // máximo permitido -- reajusta automaticamente quando a cor escolhida
  // muda o máximo (o campo continua livremente editável depois disso).
  useEffect(() => {
    setQuantity(String(effectiveMax))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando o teto muda, não a cada keystroke do próprio campo
  }, [effectiveMax])

  async function action(formData: FormData) {
    if (colorParts.some((p) => !colorChoices[p.partId])) {
      alert('Selecione a cor de cada peça antes de confirmar.')
      return
    }
    if ([...accessoryRows, ...supplyRows].some((r) => !r.id)) {
      alert('Selecione o insumo/acessório de cada linha, ou remova a linha vazia.')
      return
    }
    formData.set('colorChoicesJson', JSON.stringify(colorChoices))
    formData.set('accessoryUsagesJson', JSON.stringify(accessoryRows.map((r) => ({ id: r.id, quantityPerUnit: parseFloat(r.quantityPerUnit) || 0 }))))
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
      {colorParts.length > 0 && (
        <div className="tk-panel p-4">
          <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Cor de cada peça nesta leva</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {colorParts.map((part) => (
              <label key={part.partId} className="text-sm">
                {part.name}
                <select
                  value={colorChoices[part.partId] ?? ''}
                  onChange={(e) => setColorChoices((prev) => ({ ...prev, [part.partId]: e.target.value }))}
                  className="tk-input-full"
                  required
                >
                  <option value="" disabled>Selecione a cor</option>
                  {part.colorOptions!.map((o) => (
                    <option key={o.key} value={o.key} disabled={o.available <= 0}>
                      {o.label} ({o.available} disponível{o.available === 1 ? '' : 'is'})
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
