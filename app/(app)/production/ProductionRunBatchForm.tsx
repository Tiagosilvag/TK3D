'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProductionRunBatch } from '@/actions/productionRuns'
import { getProductProductionDefaults, type ProductProductionPartDefault } from '@/actions/products'
import { WASTE_REASON_LABELS } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import { HoursInput } from '@/components/HoursInput'
import type { WasteReason } from '@prisma/client'

const WASTE_REASON_OPTIONS = Object.keys(WASTE_REASON_LABELS) as WasteReason[]

type Option = { id: string; name: string }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface FilamentComponentRow {
  filamentId: string
  weightGramsPerUnit: string
  gramsWasted: string
}

// Melhoria "Produção" §3: uma "linha" do modal -- uma peça marcável do
// produto composto, ou a única linha implícita de um produto simples (sem
// checkbox, sempre incluída). Unifica os dois casos no mesmo shape pra não
// duplicar toda a UI de campos por linha.
interface RunRow {
  key: string
  label: string
  checked: boolean
  printerId: string
  printTimeHoursPerUnit: number
  filaments: FilamentComponentRow[]
  quantityPlanned: string
  quantitySuccess: string
  timeWastedHours: string
  wasteReason: string
  notes: string
}

function buildRowsFromParts(parts: ProductProductionPartDefault[]): RunRow[] {
  return parts.map((p) => ({
    key: p.id,
    label: p.name,
    checked: true,
    printerId: p.printerId,
    printTimeHoursPerUnit: p.printTimeHours,
    filaments: p.filaments.map((f) => ({ filamentId: f.filamentId, weightGramsPerUnit: String(f.weightGrams), gramsWasted: '0' })),
    quantityPlanned: '',
    quantitySuccess: '',
    timeWastedHours: '0',
    wasteReason: '',
    notes: '',
  }))
}

export function ProductionRunBatchForm({
  open,
  onOpenChange,
  products,
  printers,
  filaments,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: Option[]
  printers: Option[]
  filaments: Option[]
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [productId, setProductId] = useState('')
  const [date, setDate] = useState(today())
  const [rows, setRows] = useState<RunRow[]>([])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function resetAll() {
    setProductId('')
    setDate(today())
    setRows([])
  }

  async function handleProductChange(newProductId: string) {
    setProductId(newProductId)
    setRows([])
    if (!newProductId) return
    try {
      const defaults = await getProductProductionDefaults(newProductId)
      if (defaults.isComposite) {
        setRows(buildRowsFromParts(defaults.parts ?? []))
      } else {
        const product = products.find((p) => p.id === newProductId)
        setRows([
          {
            key: 'product',
            label: product?.name ?? '',
            checked: true,
            printerId: defaults.printerId ?? '',
            printTimeHoursPerUnit: defaults.printTimeHours ?? 0,
            filaments: [{ filamentId: defaults.filamentId ?? '', weightGramsPerUnit: String(defaults.weightGrams ?? 0), gramsWasted: '0' }],
            quantityPlanned: '',
            quantitySuccess: '',
            timeWastedHours: '0',
            wasteReason: '',
            notes: '',
          },
        ])
      }
    } catch {
      // Produto sem dados carregáveis não deve travar o modal.
    }
  }

  function updateRow(key: string, patch: Partial<RunRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function updateRowFilament(key: string, index: number, patch: Partial<FilamentComponentRow>) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, filaments: r.filaments.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : r)),
    )
  }

  const isComposite = rows.length > 1 || (rows.length === 1 && rows[0].key !== 'product')

  function failedFor(row: RunRow): number {
    const planned = parseInt(row.quantityPlanned, 10) || 0
    const success = parseInt(row.quantitySuccess, 10) || 0
    return Math.max(0, planned - success)
  }

  // Melhoria "Produção" §3: "Gasto por peça"/"Gasto total" -- sempre
  // derivado de peso-por-unidade × planejada de cada linha MARCADA, ao
  // vivo, nunca um campo editável à parte.
  const gastoRows = rows
    .filter((r) => r.checked)
    .flatMap((r) => {
      const planned = parseFloat(r.quantityPlanned) || 0
      return r.filaments
        .filter((f) => f.filamentId)
        .map((f) => {
          const filament = filaments.find((x) => x.id === f.filamentId)
          const grams = (parseFloat(f.weightGramsPerUnit) || 0) * planned
          return { label: `${filament?.name ?? '—'} (${r.label})`, grams }
        })
    })
    .filter((g) => g.grams > 0)
  const gastoTotal = gastoRows.reduce((sum, g) => sum + g.grams, 0)

  async function action() {
    if (!productId) {
      alert('Selecione um produto')
      return
    }
    const checkedRows = rows.filter((r) => r.checked)
    if (checkedRows.length === 0) {
      alert('Marque ao menos uma peça')
      return
    }
    for (const row of checkedRows) {
      if (!row.printerId || row.filaments.some((f) => !f.filamentId) || !row.quantityPlanned || !row.quantitySuccess) {
        alert(`Preencha impressora, filamento, planejada e sucesso de "${row.label}"`)
        return
      }
    }

    const fd = new FormData()
    fd.set('productId', productId)
    fd.set('date', date)
    fd.set(
      'itemsJson',
      JSON.stringify(
        checkedRows.map((r) => ({
          productPartId: r.key === 'product' ? null : r.key,
          printerId: r.printerId,
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
    const result = await createProductionRunBatch(fd)
    if (!result.success) {
      alert(result.error)
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
      className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form action={action} className="grid gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Registrar produção</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>

        <label className="text-sm">
          Produto
          <select value={productId} onChange={(e) => void handleProductChange(e.target.value)} className="tk-input-full" required>
            <option value="" disabled>Selecione</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {rows.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto pr-1">
            {isComposite && (
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Peças deste produto</p>
                <div className="flex gap-3 text-xs font-medium">
                  <button type="button" onClick={() => setRows((prev) => prev.map((r) => ({ ...r, checked: true })))} className="text-amber-600 hover:underline dark:text-amber-400">
                    Marcar todas
                  </button>
                  <button type="button" onClick={() => setRows((prev) => prev.map((r) => ({ ...r, checked: false })))} className="text-amber-600 hover:underline dark:text-amber-400">
                    Desmarcar todas
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {rows.map((row) => {
                const failed = failedFor(row)
                const planned = parseInt(row.quantityPlanned, 10) || 0
                return (
                  <div key={row.key} className={`rounded-lg border p-3 ${row.checked ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 opacity-60 dark:border-slate-800'}`}>
                    {isComposite && (
                      <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={row.checked} onChange={(e) => updateRow(row.key, { checked: e.target.checked })} className="rounded border" />
                        {row.label}
                      </label>
                    )}

                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      <label className="text-xs">
                        Impressora
                        <select value={row.printerId} onChange={(e) => updateRow(row.key, { printerId: e.target.value })} className="tk-input-full" disabled={!row.checked}>
                          <option value="" disabled>Selecione</option>
                          {printers.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                      {row.filaments.length === 1 && (
                        <label className="text-xs">
                          Filamento
                          <select
                            value={row.filaments[0].filamentId}
                            onChange={(e) => updateRowFilament(row.key, 0, { filamentId: e.target.value })}
                            className="tk-input-full"
                            disabled={!row.checked}
                          >
                            <option value="" disabled>Selecione</option>
                            {filaments.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      {row.filaments.length === 1 && (
                        <label className="text-xs">
                          Peso por unidade (g)
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.filaments[0].weightGramsPerUnit}
                            onChange={(e) => updateRowFilament(row.key, 0, { weightGramsPerUnit: e.target.value })}
                            className="tk-input-full"
                            disabled={!row.checked}
                          />
                        </label>
                      )}
                      <label className="text-xs">
                        Tempo por unidade (HH:MM)
                        <HoursInput
                          value={row.printTimeHoursPerUnit}
                          onChange={(hours) => updateRow(row.key, { printTimeHoursPerUnit: hours })}
                          className="tk-input-full"
                        />
                      </label>
                    </div>

                    {row.filaments.length > 1 && (
                      <div className="mt-2 space-y-2 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-700">
                        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filamento(s) desta peça</span>
                        {row.filaments.map((f, i) => (
                          <div key={i} className="grid grid-cols-2 gap-2">
                            <label className="text-xs">
                              Filamento
                              <select value={f.filamentId} onChange={(e) => updateRowFilament(row.key, i, { filamentId: e.target.value })} className="tk-input-full" disabled={!row.checked}>
                                <option value="" disabled>Selecione</option>
                                {filaments.map((opt) => (
                                  <option key={opt.id} value={opt.id}>{opt.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs">
                              Peso por unidade (g)
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={f.weightGramsPerUnit}
                                onChange={(e) => updateRowFilament(row.key, i, { weightGramsPerUnit: e.target.value })}
                                className="tk-input-full"
                                disabled={!row.checked}
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="text-xs">
                        Planejada
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={row.quantityPlanned}
                          onChange={(e) => updateRow(row.key, { quantityPlanned: e.target.value })}
                          className="tk-input-full"
                          disabled={!row.checked}
                        />
                      </label>
                      <label className="text-xs">
                        Sucesso
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={row.quantitySuccess}
                          onChange={(e) => updateRow(row.key, { quantitySuccess: e.target.value })}
                          className="tk-input-full"
                          disabled={!row.checked}
                        />
                      </label>
                      <label className="text-xs">
                        Falhas (auto)
                        <input type="number" value={failed} disabled className="tk-input-full opacity-60" />
                      </label>
                    </div>

                    {row.checked && planned > 0 && failed > 0 && (
                      <details className="mt-2">
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

            {gastoRows.length > 0 && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <p className="mb-1 font-medium text-slate-700 dark:text-slate-300">Gasto por peça</p>
                <dl className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {gastoRows.map((g, i) => (
                    <div key={i} className="flex justify-between">
                      <dt>{g.label}</dt>
                      <dd>{g.grams}g</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
                  <dt>Gasto total</dt>
                  <dd>{gastoTotal}g</dd>
                </div>
              </div>
            )}
          </div>
        )}

        <label className="text-sm">
          Data da produção
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tk-input-full" required />
        </label>

        <div className="mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
          <SubmitButton pendingLabel="Salvando…">Registrar produção</SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
