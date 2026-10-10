'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProductionRunDemandBatch } from '@/actions/productionRuns'
import { getProductProductionDefaults } from '@/actions/products'
import { WASTE_REASON_LABELS } from '@/lib/format'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { failedFor, plannedChangePatch, successChangePatch, failedChangePatch, type FilamentComponentRow } from '@/lib/productionRunRow'
import { SubmitButton } from '@/components/SubmitButton'
import { HoursInput } from '@/components/HoursInput'
import { FilamentEditor } from './ProductionRunBatchForm'
import type { WasteReason } from '@prisma/client'

const WASTE_REASON_OPTIONS = Object.keys(WASTE_REASON_LABELS) as WasteReason[]

type PrinterOption = { id: string; name: string; costPerHour: number }
type FilamentOption = { id: string; name: string; pricePerGram: number; colorHex: string | null }

// Pedido do usuário: "quero conseguir registrar produção de todos os
// pendentes, quero selecionar todos ou alguns" -- 1 linha por item marcado
// no painel "Peças pendentes de encomenda" (DemandQueuePanel), já com a
// cor/combinação que o PEDIDO precisa (filamentIds, quando a fila já sabe
// qual é) -- impressora/peso vêm da ficha técnica do produto/peça
// (getProductProductionDefaults), carregados sob demanda ao abrir.
export interface DemandSelection {
  key: string
  productId: string
  productName: string
  partId: string | null
  partName: string | null
  comboLabel: string | null
  filamentIds: string[] | null
  neededUnits: number
}

interface DemandDraftRow {
  key: string
  productId: string
  productPartId: string | null
  label: string
  date: string
  printerId: string
  printTimeHoursPerUnit: number
  filaments: FilamentComponentRow[]
  quantityPlanned: string
  quantitySuccess: string
  timeWastedHours: string
  wasteReason: string
  notes: string
}

export function DemandBatchRegisterForm({
  open,
  onOpenChange,
  selection,
  printers,
  filaments,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selection: DemandSelection[]
  printers: PrinterOption[]
  filaments: FilamentOption[]
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState<DemandDraftRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Carrega a ficha técnica (impressora/peso/tempo) de cada produto
  // ÚNICO da seleção uma vez só, depois monta 1 linha editável por item
  // selecionado -- cada peça de cor variável (1 só componente de
  // filamento) já vem com a cor que o pedido precisa pré-selecionada
  // (filamentIds), peça de receita fixa usa a cor fixa da ficha técnica.
  useEffect(() => {
    if (!open || selection.length === 0) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const uniqueProductIds = [...new Set(selection.map((s) => s.productId))]
    Promise.all(uniqueProductIds.map((id) => getProductProductionDefaults(id).then((d) => [id, d] as const)))
      .then((pairs) => {
        if (cancelled) return
        const defaultsByProduct = new Map(pairs)
        const built: DemandDraftRow[] = []
        for (const sel of selection) {
          const defaults = defaultsByProduct.get(sel.productId)
          if (!defaults) continue
          if (sel.partId) {
            const part = defaults.parts?.find((p) => p.id === sel.partId)
            if (!part) continue
            const useRequestedColor = part.filaments.length === 1 && sel.filamentIds?.length === 1
            built.push({
              key: sel.key,
              productId: sel.productId,
              productPartId: part.id,
              label: `${sel.productName} — ${part.name}`,
              date: today(),
              printerId: part.printerId,
              printTimeHoursPerUnit: part.printTimeHours,
              filaments: part.filaments.map((f) => ({
                filamentId: useRequestedColor ? sel.filamentIds![0] : f.filamentId,
                weightGramsPerUnit: String(f.weightGrams),
                gramsWasted: '0',
              })),
              quantityPlanned: String(sel.neededUnits),
              quantitySuccess: String(sel.neededUnits),
              timeWastedHours: '0',
              wasteReason: '',
              notes: '',
            })
          } else {
            built.push({
              key: sel.key,
              productId: sel.productId,
              productPartId: null,
              label: sel.productName,
              date: today(),
              printerId: defaults.printerId ?? '',
              printTimeHoursPerUnit: defaults.printTimeHours ?? 0,
              filaments: [{
                filamentId: sel.filamentIds?.[0] ?? defaults.filamentId ?? '',
                weightGramsPerUnit: String(defaults.weightGrams ?? 0),
                gramsWasted: '0',
              }],
              quantityPlanned: String(sel.neededUnits),
              quantitySuccess: String(sel.neededUnits),
              timeWastedHours: '0',
              wasteReason: '',
              notes: '',
            })
          }
        }
        setRows(built)
      })
      .catch(() => {
        if (!cancelled) setError('Erro ao carregar a ficha técnica das peças selecionadas.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, selection])

  function resetAll() {
    setRows([])
    setError(null)
  }

  function updateRow(key: string, patch: Partial<DemandDraftRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function updateRowFilament(key: string, index: number, patch: Partial<FilamentComponentRow>) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, filaments: r.filaments.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : r)),
    )
  }

  async function action() {
    if (rows.length === 0) return
    for (const row of rows) {
      if (!row.date || !row.printerId || row.filaments.some((f) => !f.filamentId) || !row.quantityPlanned || !row.quantitySuccess) {
        setError(`Preencha data, impressora, filamento, planejada e sucesso de "${row.label}"`)
        return
      }
    }
    setError(null)
    const fd = new FormData()
    fd.set(
      'itemsJson',
      JSON.stringify(
        rows.map((r) => ({
          productId: r.productId,
          productPartId: r.productPartId,
          printerId: r.printerId,
          date: r.date,
          quantityPlanned: parseInt(r.quantityPlanned, 10),
          quantitySuccess: parseInt(r.quantitySuccess, 10),
          filaments: r.filaments.map((f) => ({
            filamentId: f.filamentId,
            weightGramsPerUnit: parseFloat(f.weightGramsPerUnit) || 0,
            gramsWasted: parseFloat(f.gramsWasted) || 0,
          })),
          timeWastedHours: parseFloat(r.timeWastedHours) || 0,
          wasteReason: r.wasteReason || null,
          notes: r.notes || null,
        })),
      ),
    )
    const result = await createProductionRunDemandBatch(fd)
    if (!result.success) {
      setError(result.error ?? 'Erro ao registrar produção.')
      return
    }
    onOpenChange(false)
    resetAll()
    router.refresh()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetAll() }}
      className="w-full [--tk-dialog-cap:64rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form action={action} className="grid grid-cols-1 gap-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Registrar produção das peças selecionadas</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>

        {loading && <p className="text-sm text-slate-400 dark:text-slate-500">Carregando ficha técnica…</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!loading && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((row) => {
              const failed = failedFor(row)
              return (
                <div key={row.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p className="mb-2 text-sm font-medium">{row.label}</p>

                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <label className="text-xs">
                      Data
                      <input type="date" value={row.date} onChange={(e) => updateRow(row.key, { date: e.target.value })} className="tk-input-full" required />
                    </label>
                    <label className="text-xs">
                      Impressora
                      <select value={row.printerId} onChange={(e) => updateRow(row.key, { printerId: e.target.value })} className="tk-input-full">
                        <option value="" disabled>Selecione</option>
                        {printers.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs">
                      Tempo por unidade (HH:MM)
                      <HoursInput value={row.printTimeHoursPerUnit} onChange={(hours) => updateRow(row.key, { printTimeHoursPerUnit: hours })} className="tk-input-full" />
                    </label>
                    {row.filaments.length === 1 && (
                      <FilamentEditor
                        filaments={row.filaments}
                        filamentOptions={filaments}
                        onChange={(i, patch) => updateRowFilament(row.key, i, patch)}
                      />
                    )}
                  </div>

                  {row.filaments.length > 1 && (
                    <FilamentEditor
                      filaments={row.filaments}
                      filamentOptions={filaments}
                      onChange={(i, patch) => updateRowFilament(row.key, i, patch)}
                    />
                  )}

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <label className="text-xs">
                      Planejada
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={row.quantityPlanned}
                        onChange={(e) => updateRow(row.key, plannedChangePatch(row, e.target.value))}
                        className="tk-input-full"
                      />
                    </label>
                    <label className="text-xs">
                      Sucesso
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={row.quantitySuccess}
                        onChange={(e) => updateRow(row.key, successChangePatch(row, e.target.value))}
                        className="tk-input-full"
                      />
                    </label>
                    <label className="text-xs">
                      Falhas
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={failed}
                        onChange={(e) => updateRow(row.key, failedChangePatch(row, e.target.value))}
                        className="tk-input-full"
                      />
                    </label>
                  </div>

                  {failed > 0 && (
                    <details className="mt-2" open>
                      <summary className="cursor-pointer text-xs font-medium text-amber-600 dark:text-amber-400">Detalhes do desperdício (opcional)</summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {row.filaments.length === 1 && (
                          <label className="text-xs">
                            Filamento desperdiçado (g)
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={row.filaments[0].gramsWasted}
                              onChange={(e) => updateRowFilament(row.key, 0, { gramsWasted: e.target.value })}
                              className="tk-input-full"
                            />
                          </label>
                        )}
                        <label className="text-xs">
                          Tempo desperdiçado (HH:MM)
                          <HoursInput value={parseFloat(row.timeWastedHours) || 0} onChange={(hours) => updateRow(row.key, { timeWastedHours: String(hours) })} className="tk-input-full" />
                        </label>
                        <label className="text-xs">
                          Motivo (opcional)
                          <select value={row.wasteReason} onChange={(e) => updateRow(row.key, { wasteReason: e.target.value })} className="tk-input-full">
                            <option value="">Nenhum</option>
                            {WASTE_REASON_OPTIONS.map((reason) => (
                              <option key={reason} value={reason}>{WASTE_REASON_LABELS[reason]}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs">
                          Observações (opcional)
                          <textarea value={row.notes} onChange={(e) => updateRow(row.key, { notes: e.target.value })} className="tk-input-full" rows={1} />
                        </label>
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
          <SubmitButton pendingLabel="Salvando…" disabled={loading || rows.length === 0}>
            Registrar {rows.length > 0 ? `${rows.length} produções` : 'produção'}
          </SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
