'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmAssembly, type AssemblyPartStatus } from '@/actions/assembly'
import { SubmitButton } from '@/components/SubmitButton'

// Ajuste "cor na montagem": pra cada peça de cor variável (colorOptions
// não nulo), a montagem precisa escolher QUAL cor está sendo consumida
// nesta leva -- a quantidade máxima que dá pra montar depende de qual cor
// foi escolhida em cada peça, então recalcula a cada mudança de seleção.
function defaultColorChoice(part: AssemblyPartStatus): string {
  if (!part.colorOptions || part.colorOptions.length === 0) return ''
  const best = part.colorOptions.reduce((a, b) => (b.available > a.available ? b : a))
  return best.filamentId
}

export function ConfirmAssemblyForm({
  productId,
  parts,
}: {
  productId: string
  parts: AssemblyPartStatus[]
}) {
  const router = useRouter()
  const colorParts = useMemo(() => parts.filter((p) => p.colorOptions), [parts])
  const [colorChoices, setColorChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(colorParts.map((p) => [p.partId, defaultColorChoice(p)])),
  )

  // Máximo que dá pra montar COM AS CORES ESCOLHIDAS agora -- mínimo entre
  // as peças sem cor variável (maxUnitsFromThisPart de sempre) e as peças
  // de cor variável (limitado pela cor selecionada, não pelo total da peça).
  const effectiveMax = useMemo(() => {
    const limits = parts.map((part) => {
      if (!part.colorOptions) return part.maxUnitsFromThisPart
      const chosen = part.colorOptions.find((o) => o.filamentId === colorChoices[part.partId])
      return chosen ? Math.floor(chosen.available / part.quantityPerUnit) : 0
    })
    return limits.length === 0 ? 0 : Math.max(0, Math.min(...limits))
  }, [parts, colorChoices])

  const [quantity, setQuantity] = useState(effectiveMax > 0 ? '1' : '0')

  async function action(formData: FormData) {
    if (colorParts.some((p) => !colorChoices[p.partId])) {
      alert('Selecione a cor de cada peça antes de confirmar.')
      return
    }
    formData.set('colorChoicesJson', JSON.stringify(colorChoices))
    const result = await confirmAssembly(formData)
    if (result.success) {
      router.refresh()
    } else {
      alert(result.error)
    }
  }

  return (
    <form action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4">
      <input type="hidden" name="productId" value={productId} />

      {colorParts.length > 0 && (
        <div className="col-span-full grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-4">
          <h3 className="col-span-full text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Cor de cada peça nesta leva
          </h3>
          {colorParts.map((part) => (
            <label key={part.partId} className="text-sm">
              {part.name} *
              <select
                value={colorChoices[part.partId] ?? ''}
                onChange={(e) => setColorChoices((prev) => ({ ...prev, [part.partId]: e.target.value }))}
                className="tk-input-full"
                required
              >
                <option value="" disabled>Selecione a cor</option>
                {part.colorOptions!.map((o) => (
                  <option key={o.filamentId} value={o.filamentId} disabled={o.available <= 0}>
                    {o.filamentLabel} ({o.available} disponível{o.available === 1 ? '' : 'is'})
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <label className="text-sm">
        Quantidade a montar *
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
      <label className="col-span-full text-sm md:col-span-2">
        Observações (opcional)
        <input name="notes" className="tk-input-full" />
      </label>
      <div className="col-span-full mt-2">
        <SubmitButton pendingLabel="Montando…" disabled={effectiveMax <= 0}>
          Confirmar montagem
        </SubmitButton>
      </div>
    </form>
  )
}
