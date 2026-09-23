'use client'
import { useRef, useState } from 'react'
import { getOrderablePartOptions, type OrderablePartOption } from '@/actions/orders'
import { ComboSelect } from '../assembly/ComboSelect'

export interface CustomVariantChoice {
  choices: Record<string, string>
  label: string
}

// Encomenda com variação personalizada: reaproveita o MESMO ComboSelect
// que Montagem já usa (com allowUnavailable=true, já que o ponto aqui é
// justamente poder pedir uma cor ainda não produzida) -- peça de receita
// fixa (2+ filamentos) aparece só informativa, sem seletor. Busca as
// opções (getOrderablePartOptions) só na 1ª abertura por produto --
// OrderForm.tsx monta este componente com key={productId}, então trocar
// de produto remonta do zero.
export function CustomVariantPicker({
  productId,
  onConfirm,
  trigger,
}: {
  productId: string
  onConfirm: (choice: CustomVariantChoice) => void
  trigger: React.ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [options, setOptions] = useState<OrderablePartOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setError(null)
    dialogRef.current?.showModal()
    if (options) return
    setLoading(true)
    setLoadError(null)
    try {
      const result = await getOrderablePartOptions(productId)
      setOptions(result)
      const defaults: Record<string, string> = {}
      for (const o of result) {
        if (o.fixed || o.colorOptions.length === 0) continue
        const best = o.colorOptions.reduce((a, b) => (b.available > a.available ? b : a))
        defaults[o.partId] = best.key
      }
      setSelections(defaults)
    } catch {
      setLoadError('Não foi possível carregar as peças deste produto.')
    } finally {
      setLoading(false)
    }
  }

  function confirm() {
    if (!options) return
    const variableParts = options.filter((o) => !o.fixed)
    const missing = variableParts.find((o) => !selections[o.partId])
    if (missing) {
      setError(`Escolha a cor de ${missing.partName}`)
      return
    }
    const label = variableParts
      .map((o) => `${o.partName}: ${o.colorOptions.find((c) => c.key === selections[o.partId])?.label ?? ''}`)
      .join(' · ')
    onConfirm({ choices: selections, label })
    dialogRef.current?.close()
  }

  return (
    <>
      <span onClick={open}>{trigger}</span>
      <dialog
        ref={dialogRef}
        onClose={() => setError(null)}
        className="w-96 rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="grid grid-cols-1 gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Montar variação personalizada</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Escolha a cor de cada peça de cor variável -- se ainda não existir pronta, o sistema já cria a pendência de produção/montagem certa.
          </p>

          {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando peças…</p>}
          {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}

          {options && options.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Este produto não tem peças cadastradas.</p>
          )}

          {options?.map((o) => (
            <label key={o.partId} className="text-sm">
              {o.partName}
              {o.fixed ? (
                <p className="mt-1 rounded-lg border border-transparent bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  {o.fixedLabel} (receita fixa)
                </p>
              ) : (
                <div className="mt-1">
                  <ComboSelect
                    options={o.colorOptions}
                    value={selections[o.partId] ?? ''}
                    onChange={(key) => setSelections((prev) => ({ ...prev, [o.partId]: key }))}
                    allowUnavailable
                  />
                </div>
              )}
            </label>
          ))}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <button type="button" onClick={confirm} disabled={loading || !options} className="tk-btn-primary disabled:cursor-not-allowed disabled:opacity-60">
              Confirmar
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
