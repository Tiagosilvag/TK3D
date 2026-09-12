'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteProductionRun, getProductionRunsForProduct, type ProductionRunListItem } from '@/actions/productionRuns'

interface ReversedEntry {
  productName: string
  unitsReversed: number
}

// Melhoria "Estoque": botão "Excluir produção" no ActionsMenu de cada
// linha -- abre uma modal listando as ProductionRun não-canceladas deste
// produto (getProductionRunsForProduct), deixa selecionar quais excluir e
// exclui direto ali (deleteProductionRun, que já faz a cascata: desmonta
// ProductAssembly em excesso e estorna acessório/insumo -- ver
// actions/assembly.ts#reverseExcessAssemblyForRun). Cada exclusão
// selecionada é sua própria chamada sequencial (não uma transação única em
// lote) -- mais simples, reaproveita 100% da action já testada, e ainda
// correto porque cada chamada recalcula o déficit contra o estado já
// atualizado pela anterior. Pára no primeiro bloqueio (ex.: já vendido) e
// mostra a mensagem -- o que já foi excluído continua excluído.
export function DeleteProductionButton({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [items, setItems] = useState<ProductionRunListItem[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ deletedCount: number; reversedFrom: ReversedEntry[] } | null>(null)

  async function open() {
    setError(null)
    setSummary(null)
    setSelected(new Set())
    setLoading(true)
    dialogRef.current?.showModal()
    const runs = await getProductionRunsForProduct(productId)
    setItems(runs)
    setLoading(false)
  }

  function close() {
    dialogRef.current?.close()
    setItems(null)
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDelete() {
    if (selected.size === 0) return
    setDeleting(true)
    setError(null)
    let deletedCount = 0
    // Soma por produto, não por chamada -- a mesma peça compartilhada
    // (ex.: Mosquetão) pode aparecer em mais de uma exclusão desta leva.
    const reversedTotals = new Map<string, number>()
    for (const id of selected) {
      const result = await deleteProductionRun(id)
      if (!result.success) {
        setError(result.error ?? 'Erro ao excluir produção')
        break
      }
      deletedCount += 1
      for (const r of result.reversedFrom ?? []) {
        reversedTotals.set(r.productName, (reversedTotals.get(r.productName) ?? 0) + r.unitsReversed)
      }
    }
    setSummary({
      deletedCount,
      reversedFrom: [...reversedTotals.entries()].map(([productName, unitsReversed]) => ({ productName, unitsReversed })),
    })
    setItems(null)
    setSelected(new Set())
    setDeleting(false)
    router.refresh()
  }

  return (
    <>
      <button type="button" onClick={open} className="tk-link-danger text-left">
        Excluir produção
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => { setItems(null); setSummary(null) }}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="grid gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Excluir produção de {productName}</h3>
            <button type="button" onClick={close} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>

          {summary ? (
            <div className="grid gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {summary.deletedCount} produção{summary.deletedCount === 1 ? '' : 'ões'} excluída{summary.deletedCount === 1 ? '' : 's'}.
              </p>
              {summary.reversedFrom.length > 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  <p className="font-medium">Isso deixou peças/produtos incompletos -- produza mais pra completar essas montagens de novo:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {summary.reversedFrom.map((r) => (
                      <li key={r.productName}>{r.productName} (-{r.unitsReversed} unidade{r.unitsReversed === 1 ? '' : 's'} desmontada{r.unitsReversed === 1 ? '' : 's'})</li>
                    ))}
                  </ul>
                </div>
              )}
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={close} className="tk-btn-primary">Fechar</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Selecione quais produções excluir. Se uma produção já foi montada e virou estoque, excluí-la desmonta o excedente e estorna o acessório/insumo que ele consumiu.
              </p>

              {loading ? (
                <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">Carregando...</p>
              ) : items && items.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">Nenhuma produção encontrada.</p>
              ) : items && items.length > 0 ? (
                <>
                  <div className="flex gap-3 text-xs font-medium">
                    <button type="button" onClick={() => setSelected(new Set(items.map((i) => i.id)))} className="text-amber-600 hover:underline dark:text-amber-400">
                      Selecionar todas
                    </button>
                    <button type="button" onClick={() => setSelected(new Set())} className="text-amber-600 hover:underline dark:text-amber-400">
                      Nenhuma
                    </button>
                  </div>
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {items.map((item) => (
                      <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                        <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="rounded border" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-slate-900 dark:text-slate-100">
                            {item.partName} — {item.filamentLabel}
                          </span>
                          <span className="block text-xs text-slate-400 dark:text-slate-500">
                            {new Date(item.date).toLocaleDateString('pt-BR')} · {item.printerName} · {item.quantitySuccess} sucesso
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              ) : null}

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="mt-2 flex items-center justify-end gap-3">
                <button type="button" onClick={close} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={selected.size === 0 || deleting}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:text-slate-950 dark:hover:bg-red-400"
                >
                  {deleting ? 'Excluindo…' : `Excluir selecionadas (${selected.size})`}
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  )
}
