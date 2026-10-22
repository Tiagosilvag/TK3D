'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ConsignmentProductBreakdown, ConsignmentVariantBreakdown } from '@/lib/reports'
import { sellVariantUnits, returnVariantUnits, undoVariantMovements, setVariantUnitPrice, restoreDeliveryPrices, type VariantMovement } from '@/actions/consignmentMovements'
import { VariacaoPecas } from '@/components/VariacaoPecas'
import { UndoToast } from '@/components/UndoToast'

const integer = new Intl.NumberFormat('pt-BR')

type Toast = { message: string; undo: () => Promise<unknown> }

// Estoque com a parceira: UMA linha por variação (as entregas se somam),
// agrupado por produto. "✓ Vendeu 1" vende pelo preço da linha e comissão
// padrão; "↩ Devolver 1" devolve ao seu estoque; o preço edita direto na
// linha e vale pras próximas vendas. Cliques seguidos se juntam e toda ação
// mostra "Desfazer" por 10 s.
export function PartnerQuickStock({ partnerId, products }: { partnerId: string; products: ConsignmentProductBreakdown[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>({})

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return products
      .filter((p) => p.delivered > 0 && (!needle || p.productName.toLowerCase().includes(needle)))
      .sort((a, b) => b.remaining - a.remaining || a.productName.localeCompare(b.productName))
  }, [products, query])

  if (products.every((p) => p.delivered === 0)) return null

  const refKey = (productId: string, v: ConsignmentVariantBreakdown) => `${productId}::${v.key ?? ''}`
  const ref = (productId: string, v: ConsignmentVariantBreakdown) => ({ partnerId, productId, colorComboKey: v.key })

  async function run(action: () => Promise<{ success: boolean; error?: string; movements?: VariantMovement[] }>, message: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.success) return setError(result.error ?? 'Não foi possível concluir.')
    const movements = result.movements ?? []
    setToast({ message, undo: () => undoVariantMovements(movements) })
    router.refresh()
  }

  async function commitPrice(productId: string, v: ConsignmentVariantBreakdown) {
    const key = refKey(productId, v)
    const raw = prices[key]
    if (raw === undefined) return
    const price = Number(raw.replace(',', '.'))
    setPrices((p) => { const { [key]: _drop, ...rest } = p; void _drop; return rest })
    if (!Number.isFinite(price) || price <= 0 || Math.abs(price - v.unitPrice) < 0.005) return
    if (busy) return
    setBusy(true)
    const result = await setVariantUnitPrice(ref(productId, v), price)
    setBusy(false)
    if (!result.success) return setError(result.error ?? 'Não foi possível mudar o preço.')
    const previous = result.previous ?? []
    setToast({ message: `Preço atualizado para R$ ${price.toFixed(2).replace('.', ',')}.`, undo: () => restoreDeliveryPrices(previous) })
    router.refresh()
  }

  async function undo() {
    const t = toast
    setToast(null)
    if (!t) return
    await t.undo()
    router.refresh()
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function VariantControls({ productId, v }: { productId: string; v: ConsignmentVariantBreakdown }) {
    const key = refKey(productId, v)
    const none = v.remaining <= 0
    return (
      <>
        <td className="px-2 text-center">
          <input
            value={prices[key] ?? v.unitPrice.toFixed(2).replace('.', ',')}
            onChange={(e) => setPrices((p) => ({ ...p, [key]: e.target.value }))}
            onBlur={() => void commitPrice(productId, v)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitPrice(productId, v) } }}
            onFocus={(e) => e.target.select()}
            disabled={none}
            inputMode="decimal"
            aria-label="Preço unitário"
            className="tk-input-full w-20 text-center"
          />
        </td>
        <td className="whitespace-nowrap py-2 text-right">
          <button type="button" disabled={busy || none} onClick={() => void run(() => sellVariantUnits(ref(productId, v), 1), 'Venda de 1 registrada.')} className="tk-btn-primary px-3 py-1.5 text-xs disabled:opacity-40">✓ Vendeu 1</button>
          <button type="button" disabled={busy || none} onClick={() => void run(() => returnVariantUnits(ref(productId, v), 1), '1 devolvido ao seu estoque.')} className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">↩ Devolver 1</button>
        </td>
      </>
    )
  }

  return (
    <div className="tk-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Estoque com a parceira</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">Cada variação aparece uma vez, com as entregas somadas. Edite o preço direto na linha.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar produto…" className="tk-input-full w-48" />
          <button type="button" onClick={() => setOpen(new Set(visible.filter((p) => p.variants.length > 1).map((p) => p.productId)))} className="text-violet-600 hover:underline dark:text-violet-400">Expandir tudo</button>
          <button type="button" onClick={() => setOpen(new Set())} className="text-violet-600 hover:underline dark:text-violet-400">Recolher tudo</button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="tk-table-head-row">
              <th className="py-2 text-left">Produto</th>
              <th className="text-center">Entregue</th>
              <th className="text-center">Vendido</th>
              <th className="text-center">Devolvido</th>
              <th className="text-center">Com ela</th>
              <th className="text-center">Preço un.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const single = p.variants.length === 1
              const isOpen = open.has(p.productId)
              return (
                <ProductRows
                  key={p.productId}
                  p={p}
                  single={single}
                  isOpen={isOpen}
                  onToggle={() => toggle(p.productId)}
                  controls={(v) => <VariantControls productId={p.productId} v={v} />}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      {toast && <UndoToast message={toast.message} onUndo={undo} onDismiss={() => setToast(null)} durationMs={10000} />}
    </div>
  )
}

function ProductRows({
  p,
  single,
  isOpen,
  onToggle,
  controls,
}: {
  p: ConsignmentProductBreakdown
  single: boolean
  isOpen: boolean
  onToggle: () => void
  controls: (v: ConsignmentVariantBreakdown) => React.ReactNode
}) {
  const only = p.variants[0]
  return (
    <>
      <tr className="tk-row">
        <td className="py-2">
          {single ? (
            <span className="pl-4 font-medium text-slate-900 dark:text-slate-100">{p.productName}</span>
          ) : (
            <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
              <span className={`text-xs text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
              {p.productName}
              <span className="text-xs font-normal text-slate-400">{p.variants.length} variações</span>
            </button>
          )}
        </td>
        <td className="text-center tabular-nums">{integer.format(p.delivered)}</td>
        <td className="text-center tabular-nums">{integer.format(p.sold)}</td>
        <td className="text-center tabular-nums">{integer.format(p.returned)}</td>
        <td className="text-center font-semibold tabular-nums">{integer.format(p.remaining)}</td>
        {single ? controls(only) : <td colSpan={2}></td>}
      </tr>
      {single && only.attrs.length > 0 && (
        <tr>
          <td colSpan={7} className="pb-2 pl-4 pr-2">
            <VariacaoPecas attrs={only.attrs} />
          </td>
        </tr>
      )}
      {!single && isOpen && p.variants.map((v, i) => (
        <tr key={`${v.key ?? 'sem-cor'}-${i}`} className="bg-slate-50/60 dark:bg-slate-800/30">
          <td className="py-2 pl-8 pr-2">
            {v.attrs.length > 0 ? <VariacaoPecas attrs={v.attrs} /> : <span className="text-xs text-slate-500 dark:text-slate-400">{v.label ?? 'Sem cor registrada'}</span>}
          </td>
          <td className="text-center tabular-nums">{integer.format(v.delivered)}</td>
          <td className="text-center tabular-nums">{integer.format(v.sold)}</td>
          <td className="text-center tabular-nums">{integer.format(v.returned)}</td>
          <td className="text-center font-semibold tabular-nums">{integer.format(v.remaining)}</td>
          {controls(v)}
        </tr>
      ))}
    </>
  )
}
