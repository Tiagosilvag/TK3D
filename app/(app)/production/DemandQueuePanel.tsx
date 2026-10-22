'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getDeadlineBadge, ORDER_CHANNEL_LABELS } from '@/lib/format'
import { getItemsAwaitingAssembly, type OrderDemandRow } from '@/actions/orders'
import { getProductProductionDefaults, type ProductProductionDefaults } from '@/actions/products'
import { createProductionRunDemandBatch, undoProductionBatch } from '@/actions/productionRuns'
import { buildOneClickItem, groupByOrderItem, rollShortfalls, type OneClickItem } from '@/lib/demandOneClick'
import { UndoToast } from '@/components/UndoToast'
import type { FilamentFormOption } from '@/components/FilamentSelect'
import { DemandBatchRegisterForm, type DemandSelection } from './DemandBatchRegisterForm'

type PrinterOption = { id: string; name: string; costPerHour: number }
type FilamentOption = FilamentFormOption

// Painel "Peças pendentes de encomenda": agrupado por pedido (produto,
// origem e prazo uma vez só, peças como linhas). O caso comum é 1 clique:
// "✓ Produzido" registra a quantidade com impressora, tempo, gramas e
// filamento da ficha técnica -- antes, confere o consumo por ROLO somando
// todas as peças juntas e, se algum não cobrir, abre o formulário completo
// com o aviso em vez de registrar. "Ajustar" abre o formulário (falhas,
// troca de filamento etc.). Toda ação mostra "Desfazer" por 10 s.
//
// A pendência não é um contador: getOrderDemandQueue a deriva das produções
// existentes, então desfazer/editar/excluir uma produção devolve a
// pendência certa sozinho.
const rowKey = (row: OrderDemandRow) => `${row.orderItemId}:${row.partId ?? 'produto'}`

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DemandQueuePanel({ rows, printers, filaments }: { rows: OrderDemandRow[]; printers: PrinterOption[]; filaments: FilamentOption[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [qty, setQty] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; batchId?: string } | null>(null)
  const [adjust, setAdjust] = useState<DemandSelection[] | null>(null)
  const defaultsCache = useRef(new Map<string, ProductProductionDefaults>())

  const groups = useMemo(() => groupByOrderItem(rows), [rows])
  const stockById = useMemo(() => new Map(filaments.map((f) => [f.id, f.stockGrams ?? 0])), [filaments])
  const filamentName = (id: string) => filaments.find((f) => f.id === id)?.name ?? 'filamento'

  const adjustSelection = useMemo(() => adjust ?? [], [adjust])

  // Tudo registrado: só o aviso com "Desfazer" fica na tela.
  if (rows.length === 0) {
    return toast ? <UndoToast message={toast.message} onUndo={toast.batchId ? undo : undefined} onDismiss={() => setToast(null)} durationMs={10000} /> : null
  }

  function qtyFor(row: OrderDemandRow): number {
    const parsed = parseInt(qty[rowKey(row)] ?? '', 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : row.neededUnits
  }

  function toSelection(row: OrderDemandRow): DemandSelection {
    return {
      key: rowKey(row),
      productId: row.productId,
      productName: row.productName,
      partId: row.partId,
      partName: row.partName,
      comboLabel: row.comboLabel,
      filamentIds: row.filamentIds,
      neededUnits: qtyFor(row),
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function defaultsFor(productId: string): Promise<ProductProductionDefaults> {
    const cached = defaultsCache.current.get(productId)
    if (cached) return cached
    const fresh = await getProductProductionDefaults(productId)
    defaultsCache.current.set(productId, fresh)
    return fresh
  }

  // Registro em 1 clique de N linhas. Qualquer impedimento (ficha incompleta,
  // rolo que não cobre) abre o formulário completo -- nunca registra pela metade.
  async function registerRows(target: OrderDemandRow[]) {
    if (target.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const items: OneClickItem[] = []
      for (const row of target) {
        const built = buildOneClickItem(
          { productId: row.productId, partId: row.partId, filamentIds: row.filamentIds, quantity: qtyFor(row) },
          await defaultsFor(row.productId),
          todayIso(),
        )
        if ('error' in built) {
          setError(`${row.productName}${row.partName ? ` — ${row.partName}` : ''}: ${built.error} Abrindo o formulário para completar.`)
          setAdjust(target.map(toSelection))
          return
        }
        items.push(built)
      }

      const short = rollShortfalls(items, stockById)
      if (short.length > 0) {
        const s = short[0]
        setError(`${filamentName(s.filamentId)} não cobre: precisa de ${s.needed.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g e tem ${s.available.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g. Abrindo o formulário para ajustar.`)
        setAdjust(target.map(toSelection))
        return
      }

      const fd = new FormData()
      fd.set('itemsJson', JSON.stringify(items))
      const result = await createProductionRunDemandBatch(fd)
      if (!result.success) {
        setError(result.error ?? 'Erro ao registrar produção.')
        return
      }
      const units = items.reduce((sum, i) => sum + i.quantitySuccess, 0)
      // Pedido que ficou com todas as peças: segue para Aguardando montagem.
      const ready = await getItemsAwaitingAssembly([...new Set(target.map((r) => r.orderItemId))])
      const readyText = ready.length > 0 ? ` ${ready.map((r) => `${r.productName}${r.buyerOrPlatform ? ` (${r.buyerOrPlatform})` : ''}`).join(', ')} segue${ready.length > 1 ? 'm' : ''} para Aguardando montagem.` : ''
      setToast({ message: `${units} ${units === 1 ? 'peça registrada' : 'peças registradas'}.${readyText}`, batchId: result.batchId })
      setSelected(new Set())
      router.refresh()
    } catch {
      setError('Erro ao registrar produção.')
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    const batchId = toast?.batchId
    setToast(null)
    if (!batchId) return
    const result = await undoProductionBatch(batchId)
    if (!result.success) setError(result.error ?? 'Não foi possível desfazer.')
    router.refresh()
  }

  const selectedRows = rows.filter((r) => selected.has(rowKey(r)))

  return (
    <div className="tk-panel mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Peças pendentes de encomenda</h2>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{rows.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
          <button type="button" onClick={() => setSelected(new Set(rows.map(rowKey)))} className="text-violet-600 hover:underline dark:text-violet-400">Marcar todas</button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-violet-600 hover:underline dark:text-violet-400">Desmarcar todas</button>
          {selectedRows.length > 0 && (
            <>
              <button type="button" onClick={() => setAdjust(selectedRows.map(toSelection))} className="text-violet-600 hover:underline dark:text-violet-400">
                Ajustar selecionadas
              </button>
              <button type="button" disabled={busy} onClick={() => registerRows(selectedRows)} className="tk-btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
                ✓ Registrar selecionadas ({selectedRows.length})
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
        Ordenado pelo prazo de entrega mais próximo. A quantidade ao lado é editável (produziu só parte? digite e clique ✓). Use Ajustar para falhas, filamento ou outras mudanças.
      </p>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 space-y-3">
        {groups.map((group) => {
          const first = group.rows[0]
          const deadline = getDeadlineBadge(new Date(first.deliveryDate), first.status)
          return (
            <section key={group.orderItemId} className="rounded-lg border border-slate-200 dark:border-slate-700">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{first.productName}</h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Pedido {ORDER_CHANNEL_LABELS[first.channel]}
                    {first.buyerOrPlatform ? ` · ${first.buyerOrPlatform}` : first.orderNumber ? ` · #${first.orderNumber}` : ''}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${deadline.className}`}>{deadline.label}</span>
                  {first.reservedQuantity > 0 && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">{first.reservedQuantity} de {first.quantity} reservado</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setAdjust(group.rows.map(toSelection))} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                    Ajustar
                  </button>
                  <button type="button" disabled={busy} onClick={() => registerRows(group.rows)} className="tk-btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
                    ✓ Registrar todas ({group.rows.length})
                  </button>
                </div>
              </header>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {group.rows.map((row) => {
                  const key = rowKey(row)
                  const fil = row.filamentIds?.length === 1 ? filaments.find((f) => f.id === row.filamentIds![0]) : null
                  return (
                    <li key={key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} aria-label={`Selecionar ${row.partName ?? row.productName}`} className="rounded border" />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{row.partName ?? row.productName}</span>
                        {row.comboLabel && (
                          <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400">
                            {fil?.colorHex && <span style={{ background: fil.colorHex }} className="inline-block h-2.5 w-2.5 rounded-full border border-black/10" />}
                            {row.comboLabel}
                          </span>
                        )}
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={qty[key] ?? String(row.neededUnits)}
                          onChange={(e) => setQty((prev) => ({ ...prev, [key]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              registerRows([row])
                            }
                          }}
                          aria-label={`Quantidade de ${row.partName ?? row.productName}`}
                          className="tk-input-full w-16 text-center"
                        />
                        de <b className="text-slate-900 dark:text-slate-100">{row.neededUnits}</b> que faltam
                      </label>
                      <button type="button" onClick={() => setAdjust([toSelection(row)])} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                        Ajustar
                      </button>
                      <button type="button" disabled={busy} onClick={() => registerRows([row])} className="tk-btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
                        ✓ Produzido
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      <DemandBatchRegisterForm
        open={adjust !== null}
        onOpenChange={(open) => { if (!open) setAdjust(null) }}
        selection={adjustSelection}
        printers={printers}
        filaments={filaments}
      />

      {toast && <UndoToast message={toast.message} onUndo={toast.batchId ? undo : undefined} onDismiss={() => setToast(null)} durationMs={10000} />}
    </div>
  )
}
