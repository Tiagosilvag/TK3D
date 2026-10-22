'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UndoToast } from '@/components/UndoToast'
import { createConsignmentSaleReportBatch, undoConsignmentSaleReportBatch } from '@/actions/consignmentSaleReports'
import type { ConsignmentSaleableDelivery } from '@/lib/reports'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import { VariacaoPecas } from '@/components/VariacaoPecas'

// Redesign "Registrar venda": paleta cíclica por categoria (Product.category
// é texto livre, sem cor própria cadastrada) -- índice fixado pela ORDEM DE
// PRIMEIRA APARIÇÃO entre as linhas (estável entre re-renders, já que
// `deliveries` não muda de ordem sozinho), nunca por hash de texto (evitaria
// recalcular, mas duas categorias podiam colidir na mesma cor).
const CATEGORY_PALETTE = [
  { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', active: 'bg-violet-600 text-white', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', active: 'bg-emerald-600 text-white', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', active: 'bg-amber-600 text-white', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  { dot: 'bg-pink-500', text: 'text-pink-600 dark:text-pink-400', active: 'bg-pink-600 text-white', badge: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300' },
  { dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400', active: 'bg-sky-600 text-white', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  { dot: 'bg-teal-500', text: 'text-teal-600 dark:text-teal-400', active: 'bg-teal-600 text-white', badge: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300' },
  { dot: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', active: 'bg-orange-600 text-white', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300' },
  { dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', active: 'bg-rose-600 text-white', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' },
]

function buildCategoryColors(deliveries: ConsignmentSaleableDelivery[]): Map<string, (typeof CATEGORY_PALETTE)[number]> {
  const map = new Map<string, (typeof CATEGORY_PALETTE)[number]>()
  for (const d of deliveries) {
    if (!map.has(d.category)) map.set(d.category, CATEGORY_PALETTE[map.size % CATEGORY_PALETTE.length])
  }
  return map
}

function yesterdayString(): string {
  const d = new Date(today())
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function QtyStepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Diminuir" className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-30 dark:border-slate-600 dark:text-slate-300">−</button>
      <span className="w-5 text-center text-sm font-medium tabular-nums">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Aumentar" className="flex h-6 w-6 items-center justify-center rounded-full border border-violet-400 text-violet-600 disabled:opacity-30 dark:border-violet-500 dark:text-violet-400">+</button>
    </div>
  )
}

function PriceStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(0, Math.round((value - 1) * 100) / 100))} aria-label="Diminuir preço" className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300">−</button>
      <span className="w-16 text-center text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(value)}</span>
      <button type="button" onClick={() => onChange(Math.round((value + 1) * 100) / 100)} aria-label="Aumentar preço" className="flex h-6 w-6 items-center justify-center rounded-full border border-violet-400 text-violet-600 dark:border-violet-500 dark:text-violet-400">+</button>
    </div>
  )
}

// Redesign "Registrar venda": o modal antigo era uma lista de cards com
// checkbox + 2 campos de digitação (quantidade vazia, preço) por linha --
// vender 5 produtos exigia marcar, digitar e conferir preço 5 vezes, sem
// categoria visível e sem o lucro calculado até depois de registrar.
// Agora é só −/+ direto em "Vendeu" (0 por padrão, sem checkbox -- a
// própria quantidade > 0 já significa "vai entrar na venda"), preço
// pré-preenchido e ajustável, chips de categoria (agrupam e filtram) e o
// rodapé (Vendido/Comissão/Custo/Lucro) sempre visível, recalculado a
// cada clique -- mesmo padrão de UI já usado no redesign de "Registrar
// entrega" (DeliveryBatchForm.tsx), só sem a necessidade de "expandir"
// produto (aqui já existe 1 saldo por grupo produto+cor, não um catálogo
// inteiro pra escolher variação antes de poder vender).
export function RegisterSaleForm({
  deliveries,
  defaultCommissionPercent,
}: {
  deliveries: ConsignmentSaleableDelivery[]
  defaultCommissionPercent: number
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [dateMode, setDateMode] = useState<'hoje' | 'ontem' | 'outra'>('hoje')
  const [reportDate, setReportDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [commissionText, setCommissionText] = useState(String(Math.round(defaultCommissionPercent * 10000) / 100).replace('.', ','))
  const [toast, setToast] = useState<{ message: string; ids: string[] } | null>(null)
  const commissionPercent = Math.min(1, Math.max(0, (Number(commissionText.replace(',', '.')) || 0) / 100))

  const categoryColors = useMemo(() => buildCategoryColors(deliveries), [deliveries])
  const deliveryByKey = useMemo(() => new Map(deliveries.map((d) => [d.groupKey, d])), [deliveries])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function resetFields() {
    setQuantities({})
    setPrices({})
    setSearch('')
    setCategoryFilter(null)
    setDateMode('hoje')
    setReportDate(today())
    setNotes('')
    setNotesOpen(false)
    setError('')
  }

  function priceFor(d: ConsignmentSaleableDelivery): number {
    return prices[d.groupKey] ?? d.unitPrice
  }

  function setQty(groupKey: string, next: number, remaining: number) {
    const clamped = Math.max(0, Math.min(remaining, next))
    setQuantities((prev) => {
      if (clamped === 0) {
        const { [groupKey]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [groupKey]: clamped }
    })
  }

  function setPrice(groupKey: string, next: number) {
    setPrices((prev) => ({ ...prev, [groupKey]: Math.max(0, next) }))
  }

  const normalizedSearch = search.trim().toLowerCase()
  const visibleDeliveries = useMemo(() => deliveries.filter((d) => {
    if (categoryFilter && d.category !== categoryFilter) return false
    if (normalizedSearch && !`${d.productName} ${d.colorLabel ?? ''}`.toLowerCase().includes(normalizedSearch)) return false
    return true
  }), [deliveries, categoryFilter, normalizedSearch])

  // Chips de categoria com contagem de PRODUTOS (não de peças em saldo) --
  // "Todas N" soma todas as linhas, cada categoria soma só as suas, sempre
  // sobre o filtro de busca atual (nunca sobre o de categoria, que é o
  // próprio chip clicado).
  const searchFiltered = useMemo(() => (
    normalizedSearch ? deliveries.filter((d) => `${d.productName} ${d.colorLabel ?? ''}`.toLowerCase().includes(normalizedSearch)) : deliveries
  ), [deliveries, normalizedSearch])
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of searchFiltered) counts.set(d.category, (counts.get(d.category) ?? 0) + 1)
    return counts
  }, [searchFiltered])
  const categoryOrder = useMemo(() => [...categoryColors.keys()], [categoryColors])

  // Agrupado por categoria, na ordem de 1ª aparição -- itens dentro do
  // grupo por nome (pedido explícito "itens por nome").
  const groups = useMemo(() => {
    const byCategory = new Map<string, ConsignmentSaleableDelivery[]>()
    for (const d of visibleDeliveries) {
      const list = byCategory.get(d.category) ?? []
      list.push(d)
      byCategory.set(d.category, list)
    }
    return categoryOrder
      .filter((cat) => byCategory.has(cat))
      .map((cat) => ({ category: cat, items: [...byCategory.get(cat)!].sort((a, b) => a.productName.localeCompare(b.productName)) }))
  }, [visibleDeliveries, categoryOrder])

  function applyOnePerVisible() {
    setQuantities((prev) => {
      const next = { ...prev }
      for (const d of visibleDeliveries) {
        const current = next[d.groupKey] ?? 0
        if (current < d.remaining) next[d.groupKey] = current + 1
      }
      return next
    })
    setPrices((prev) => {
      const next = { ...prev }
      for (const d of visibleDeliveries) {
        if (next[d.groupKey] === undefined) next[d.groupKey] = d.unitPrice
      }
      return next
    })
  }

  // "Vendeu tudo": tudo o que ela tem, entre os itens visíveis.
  function sellAllVisible() {
    setQuantities((prev) => {
      const next = { ...prev }
      for (const d of visibleDeliveries) next[d.groupKey] = d.remaining
      return next
    })
    setError('')
  }

  async function undoSale() {
    const t = toast
    setToast(null)
    if (!t) return
    await undoConsignmentSaleReportBatch(t.ids)
    router.refresh()
  }

  function handleClear() {
    setQuantities({})
    setError('')
  }

  const soldLines = useMemo(() => Object.entries(quantities).filter(([, qty]) => qty > 0).map(([groupKey, qty]) => ({ delivery: deliveryByKey.get(groupKey)!, qty })).filter((l) => l.delivery), [quantities, deliveryByKey])
  const totalPieces = soldLines.reduce((sum, l) => sum + l.qty, 0)
  const totalSoldValue = soldLines.reduce((sum, l) => sum + l.qty * priceFor(l.delivery), 0)
  const totalCommission = totalSoldValue * commissionPercent
  const totalCost = soldLines.reduce((sum, l) => sum + l.qty * l.delivery.unitCost, 0)
  const totalProfit = totalSoldValue - totalCommission - totalCost

  function handleDateChip(mode: 'hoje' | 'ontem' | 'outra') {
    setDateMode(mode)
    if (mode === 'hoje') setReportDate(today())
    if (mode === 'ontem') setReportDate(yesterdayString())
  }

  async function action() {
    if (soldLines.length === 0) {
      setError('Marque ao menos 1 peça vendida')
      return
    }
    setError('')
    setSavedMessage(null)

    const fd = new FormData()
    fd.set('reportDate', reportDate)
    fd.set('notes', notes || '')
    fd.set(
      'itemsJson',
      JSON.stringify(
        soldLines.map((l) => ({
          deliveryIds: l.delivery.deliveryIds,
          quantitySold: l.qty,
          commissionPercent,
          unitPrice: priceFor(l.delivery),
        })),
      ),
    )
    const result = await createConsignmentSaleReportBatch(fd)
    if (!result.success) {
      setError(result.error ?? 'Erro ao registrar venda')
      return
    }
    setSavedMessage(`Venda registrada · ${totalPieces} ${totalPieces === 1 ? 'peça' : 'peças'} · ${formatCurrency(totalSoldValue)}`)
    setQuantities({})
    if (result.reportIds?.length) setToast({ message: `Venda registrada · ${totalPieces} ${totalPieces === 1 ? 'peça' : 'peças'}.`, ids: result.reportIds })
    router.refresh()
  }

  if (deliveries.length === 0) return null

  return (
    <>
      <button type="button" onClick={() => { resetFields(); setSavedMessage(null); setOpen(true) }} className="tk-btn-primary px-3 py-1.5 text-sm">
        + Registrar venda
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => { setOpen(false); resetFields() }}
        className="w-full [--tk-dialog-cap:34rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:[--tk-dialog-cap:44rem]"
      >
        <form action={action} className="grid grid-cols-1 gap-3 p-5">
          <div className="flex items-center justify-between">
            <div>
              <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Comissão
                <input value={commissionText} onChange={(e) => setCommissionText(e.target.value)} onFocus={(e) => e.target.select()} inputMode="decimal" aria-label="Comissão %" className="tk-input-full w-14 py-0.5 text-center" />%
              </label>
              <h3 className="font-display text-base font-semibold">Registrar venda</h3>
            </div>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>

          {savedMessage && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
              ✓ {savedMessage}
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por produto ou cor…"
              className="tk-input min-w-0 flex-1"
            />
            <button type="button" onClick={applyOnePerVisible} className="shrink-0 rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/30">
              +1 em cada
            </button>
            <button type="button" onClick={sellAllVisible} className="shrink-0 rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/30">
              Vendeu tudo
            </button>
            {Object.keys(quantities).length > 0 && (
              <button type="button" onClick={handleClear} className="shrink-0 text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                Limpar
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${categoryFilter === null ? 'bg-violet-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              Todas {searchFiltered.length}
            </button>
            {categoryOrder.filter((cat) => categoryCounts.has(cat)).map((cat) => {
              const colors = categoryColors.get(cat)!
              const active = categoryFilter === cat
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter((prev) => (prev === cat ? null : cat))}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${active ? colors.active : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                >
                  {!active && <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors.dot}`} />}
                  {cat} {categoryCounts.get(cat)}
                </button>
              )
            })}
          </div>

          <div className="max-h-[26rem] space-y-4 overflow-y-auto pr-1">
            {groups.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum produto encontrado.</p>
            )}
            {groups.map(({ category, items }) => {
              const colors = categoryColors.get(category)!
              const groupSaldo = items.reduce((s, d) => s + d.remaining, 0)
              return (
                <div key={category}>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                    <span className={`inline-block h-2 w-2 rounded-full ${colors.dot}`} />
                    <span className={colors.text}>{category}</span>
                    <span className="font-normal normal-case text-slate-400 dark:text-slate-500">· {items.length} {items.length === 1 ? 'produto' : 'produtos'} · {groupSaldo} em saldo</span>
                  </p>
                  <div className="space-y-1.5">
                    {items.map((d) => {
                      const qty = quantities[d.groupKey] ?? 0
                      const price = priceFor(d)
                      const subtotal = qty * price
                      const active = qty > 0
                      return (
                        <div
                          key={d.groupKey}
                          className={`rounded-lg border p-2.5 ${active ? 'border-l-4 border-violet-500 bg-violet-50/60 dark:border-l-violet-400 dark:bg-violet-500/10' : 'border-slate-200 dark:border-slate-700'}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                                {d.productName}
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${colors.badge}`}>{category}</span>
                              </p>
                              {d.attrs.length > 0 ? (
                                <div className="mt-1 max-w-xs">
                                  <VariacaoPecas attrs={d.attrs} />
                                </div>
                              ) : d.colorLabel && (
                                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                  {d.colorHex && <span style={{ background: d.colorHex }} className="inline-block h-2 w-2 shrink-0 rounded-full" />}
                                  {d.colorLabel}
                                </p>
                              )}
                            </div>
                            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                              Saldo {d.remaining}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              Vendeu
                              <QtyStepper value={qty} min={0} max={d.remaining} onChange={(v) => setQty(d.groupKey, v, d.remaining)} />
                            </label>
                            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              Preço un.
                              <PriceStepper value={price} onChange={(v) => setPrice(d.groupKey, v)} />
                            </label>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              Subtotal <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{subtotal > 0 ? formatCurrency(subtotal) : '—'}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5 text-center dark:bg-slate-800/60 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Vendido ({totalPieces} {totalPieces === 1 ? 'peça' : 'peças'})</p>
              <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalSoldValue)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500 dark:text-amber-400">Comissão {(commissionPercent * 100).toFixed(0)}%</p>
              <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalCommission)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-500 dark:text-rose-400">Custo</p>
              <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalCost)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 py-1 dark:bg-emerald-500/10">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Meu lucro</p>
              <p className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatCurrency(totalProfit)}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Data do relatório</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {(['hoje', 'ontem'] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => handleDateChip(mode)} className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${dateMode === mode ? 'bg-violet-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                    {mode}
                  </button>
                ))}
                <button type="button" onClick={() => handleDateChip('outra')} className={`rounded-full px-3 py-1 text-xs font-medium ${dateMode === 'outra' ? 'bg-violet-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                  Outra data…
                </button>
                {dateMode === 'outra' && (
                  <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="tk-input w-36" required />
                )}
              </div>
            </div>
            {notesOpen ? (
              <label className="text-xs text-slate-500 dark:text-slate-400">
                Observações (opcional)
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="tk-input-full" rows={1} autoFocus />
              </label>
            ) : (
              <button type="button" onClick={() => setNotesOpen(true)} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                + Observação (opcional)
              </button>
            )}
          </div>

          <div className="mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
            <SubmitButton pendingLabel="Registrando…" disabled={soldLines.length === 0}>
              Registrar venda{totalPieces > 0 ? ` (${totalPieces})` : ''}
            </SubmitButton>
          </div>
        </form>
      </dialog>
      {toast && <UndoToast message={toast.message} onUndo={() => void undoSale()} onDismiss={() => setToast(null)} durationMs={10000} />}
    </>
  )
}
