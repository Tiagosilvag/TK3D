'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProductionRunBatch, createPlate } from '@/actions/productionRuns'
import { getProductProductionDefaults, type ProductProductionPartDefault } from '@/actions/products'
import { getAvailablePrinterCapture } from '@/actions/bambuStatus'
import { buildPlateAutofill } from '@/lib/bambu/autofill'
import { WASTE_REASON_LABELS } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import { HoursInput } from '@/components/HoursInput'
import type { WasteReason } from '@prisma/client'

const WASTE_REASON_OPTIONS = Object.keys(WASTE_REASON_LABELS) as WasteReason[]

type Option = { id: string; name: string }
// Melhoria "Produção" (reformulação Plate): filamento agora carrega
// pricePerGram -- usado pelas novas colunas R$/g e Custo da tabela de
// cores (spec §3 do pedido de reformulação), calculado uma vez no server
// (lib/costing.ts#calculateFilamentPricePerGram) a partir de spoolPrice/
// spoolWeightKg, sem precisar buscar o filamento inteiro aqui.
type FilamentOption = { id: string; name: string; pricePerGram: number }

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
// duplicar toda a UI de campos por linha. Melhoria "Produção" (reformulação
// Plate) REGRA 7: `date` deixou de ser um campo único pro modal inteiro --
// cada peça tem a sua própria, editável aqui.
interface RunRow {
  key: string
  label: string
  checked: boolean
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

// Melhoria "Produção" (reformulação Plate) REGRA 9: um item de uma Plate --
// mesmo shape de dado de uma peça, mas com productId/productName próprios
// (uma Plate pode misturar peças de produtos DIFERENTES) e SEM
// printerId/date próprios (herdados da Plate inteira, que é uma única
// impressão física).
interface PlateItemRow {
  key: string
  productId: string
  productName: string
  partId: string | null
  partName: string
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
    date: today(),
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

function failedFor(row: { quantityPlanned: string; quantitySuccess: string }): number {
  const planned = parseInt(row.quantityPlanned, 10) || 0
  const success = parseInt(row.quantitySuccess, 10) || 0
  return Math.max(0, planned - success)
}

// Melhoria "Produção" (reformulação Plate) §3: editor de filamento(s) de
// uma peça, compartilhado entre linha individual e item de Plate --
// mostra R$/g e Custo por cor (gramas × R$/g), além do peso já existente.
// Peça de 1 componente usa campos inline (mesma UX de antes, só com as
// duas colunas novas); peça multi-filamento vira uma tabela de verdade.
function FilamentEditor({
  filaments,
  filamentOptions,
  onChange,
  disabled,
}: {
  filaments: FilamentComponentRow[]
  filamentOptions: FilamentOption[]
  onChange: (index: number, patch: Partial<FilamentComponentRow>) => void
  disabled?: boolean
}) {
  function priceFor(filamentId: string): number {
    return filamentOptions.find((f) => f.id === filamentId)?.pricePerGram ?? 0
  }

  if (filaments.length === 1) {
    const f = filaments[0]
    const pricePerGram = priceFor(f.filamentId)
    const cost = (parseFloat(f.weightGramsPerUnit) || 0) * pricePerGram
    return (
      <>
        <label className="text-xs">
          Filamento
          <select value={f.filamentId} onChange={(e) => onChange(0, { filamentId: e.target.value })} className="tk-input-full" disabled={disabled}>
            <option value="" disabled>Selecione</option>
            {filamentOptions.map((opt) => (
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
            onChange={(e) => onChange(0, { weightGramsPerUnit: e.target.value })}
            className="tk-input-full"
            disabled={disabled}
          />
        </label>
        <label className="text-xs">
          R$/g
          <input type="text" value={pricePerGram ? pricePerGram.toFixed(4) : '—'} disabled className="tk-input-full opacity-60" />
        </label>
        <label className="text-xs">
          Custo
          <input type="text" value={cost ? cost.toFixed(2) : '—'} disabled className="tk-input-full opacity-60" />
        </label>
      </>
    )
  }

  return (
    <div className="col-span-2 mt-2 space-y-2 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-700 md:col-span-4">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filamento(s) desta peça</span>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400">
              <th className="pb-1 pr-2 font-medium">Cor/Filamento</th>
              <th className="pb-1 pr-2 font-medium">Gramas</th>
              <th className="pb-1 pr-2 font-medium">R$/g</th>
              <th className="pb-1 font-medium">Custo</th>
            </tr>
          </thead>
          <tbody>
            {filaments.map((f, i) => {
              const pricePerGram = priceFor(f.filamentId)
              const cost = (parseFloat(f.weightGramsPerUnit) || 0) * pricePerGram
              return (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <select value={f.filamentId} onChange={(e) => onChange(i, { filamentId: e.target.value })} className="tk-input-full" disabled={disabled}>
                      <option value="" disabled>Selecione</option>
                      {filamentOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={f.weightGramsPerUnit}
                      onChange={(e) => onChange(i, { weightGramsPerUnit: e.target.value })}
                      className="tk-input-full"
                      disabled={disabled}
                    />
                  </td>
                  <td className="py-1 pr-2 tabular-nums text-slate-500 dark:text-slate-400">{pricePerGram ? pricePerGram.toFixed(4) : '—'}</td>
                  <td className="py-1 tabular-nums text-slate-500 dark:text-slate-400">{cost ? cost.toFixed(2) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
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
  filaments: FilamentOption[]
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Melhoria "Produção" (reformulação Plate): "Modo de produção" --
  // individual (comportamento de sempre, um produto só, campos de
  // data/impressora por peça) ou Plate (várias peças, possivelmente de
  // produtos diferentes, impressas juntas -- data/impressora únicas pro
  // grupo inteiro, custo de impressora rateado no server).
  const [mode, setMode] = useState<'individual' | 'plate'>('individual')

  // --- Estado do modo "Produção individual" (igual antes, + date por linha)
  const [productId, setProductId] = useState('')
  const [rows, setRows] = useState<RunRow[]>([])

  // --- Estado do modo "Plate"
  const [plateDate, setPlateDate] = useState(today())
  const [platePrinterId, setPlatePrinterId] = useState('')
  const [plateNotes, setPlateNotes] = useState('')
  const [plateItems, setPlateItems] = useState<PlateItemRow[]>([])
  const [addProductId, setAddProductId] = useState('')
  const [addProductParts, setAddProductParts] = useState<ProductProductionPartDefault[] | null>(null)

  // Integração Bambu Lab (spec 2026-09-11): captura de telemetria real
  // ainda não vinculada a nenhuma Plate, oferecida como autofill quando a
  // impressora escolhida tem uma disponível (ver actions/bambuStatus.ts).
  const [availableCapture, setAvailableCapture] = useState<Awaited<ReturnType<typeof getAvailablePrinterCapture>>>(null)
  const [plateActualPrintTimeHours, setPlateActualPrintTimeHours] = useState<number | null>(null)
  const [usedCaptureId, setUsedCaptureId] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!platePrinterId) {
      setAvailableCapture(null)
      return
    }
    let cancelled = false
    getAvailablePrinterCapture(platePrinterId).then((capture) => {
      if (!cancelled) setAvailableCapture(capture)
    })
    return () => {
      cancelled = true
    }
  }, [platePrinterId])

  function resetAll() {
    setMode('individual')
    setProductId('')
    setRows([])
    setPlateDate(today())
    setPlatePrinterId('')
    setPlateNotes('')
    setPlateItems([])
    setAddProductId('')
    setAddProductParts(null)
    setAvailableCapture(null)
    setPlateActualPrintTimeHours(null)
    setUsedCaptureId(null)
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
            date: today(),
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

  // --- Plate: "+ Adicionar peça" -- escolhe um produto, mostra suas peças
  // (ou o próprio produto, se simples) pra adicionar como item da Plate.
  async function handleAddProductChange(newProductId: string) {
    setAddProductId(newProductId)
    setAddProductParts(null)
    if (!newProductId) return
    try {
      const defaults = await getProductProductionDefaults(newProductId)
      if (defaults.isComposite) {
        setAddProductParts(defaults.parts ?? [])
      } else {
        // Produto simples: representado como uma "peça" só, com partId nulo
        // -- mesma convenção do modo individual.
        setAddProductParts([
          {
            id: '__simple__',
            name: products.find((p) => p.id === newProductId)?.name ?? '',
            printerId: defaults.printerId ?? '',
            filaments: [{ filamentId: defaults.filamentId ?? '', weightGrams: defaults.weightGrams ?? 0 }],
            printTimeHours: defaults.printTimeHours ?? 0,
          },
        ])
      }
    } catch {
      // Produto sem dados carregáveis não deve travar o modal.
    }
  }

  function addPlateItem(part: ProductProductionPartDefault) {
    const product = products.find((p) => p.id === addProductId)
    const isSimple = part.id === '__simple__'
    setPlateItems((prev) => [
      ...prev,
      {
        key: `${addProductId}-${part.id}-${crypto.randomUUID()}`,
        productId: addProductId,
        productName: product?.name ?? '',
        partId: isSimple ? null : part.id,
        partName: part.name,
        printTimeHoursPerUnit: part.printTimeHours,
        filaments: part.filaments.map((f) => ({ filamentId: f.filamentId, weightGramsPerUnit: String(f.weightGrams), gramsWasted: '0' })),
        quantityPlanned: '',
        quantitySuccess: '',
        timeWastedHours: '0',
        wasteReason: '',
        notes: '',
      },
    ])
  }

  function updatePlateItem(key: string, patch: Partial<PlateItemRow>) {
    setPlateItems((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function updatePlateItemFilament(key: string, index: number, patch: Partial<FilamentComponentRow>) {
    setPlateItems((prev) =>
      prev.map((r) => (r.key === key ? { ...r, filaments: r.filaments.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : r)),
    )
  }

  function removePlateItem(key: string) {
    setPlateItems((prev) => prev.filter((r) => r.key !== key))
  }

  // Melhoria "Produção" §3: "Gasto por peça"/"Gasto total" -- sempre
  // derivado de peso-por-unidade × planejada de cada linha/item ATIVO, ao
  // vivo, nunca um campo editável à parte. Cobre os dois modos.
  const activeRowsForGasto: { label: string; filaments: FilamentComponentRow[]; quantityPlanned: string }[] =
    mode === 'individual'
      ? rows.filter((r) => r.checked).map((r) => ({ label: r.label, filaments: r.filaments, quantityPlanned: r.quantityPlanned }))
      : plateItems.map((r) => ({ label: `${r.partName} (${r.productName})`, filaments: r.filaments, quantityPlanned: r.quantityPlanned }))

  const gastoRows = activeRowsForGasto
    .flatMap((r) => {
      const planned = parseFloat(r.quantityPlanned) || 0
      return r.filaments
        .filter((f) => f.filamentId)
        .map((f) => {
          const filament = filaments.find((x) => x.id === f.filamentId)
          const grams = (parseFloat(f.weightGramsPerUnit) || 0) * planned
          const cost = grams * (filament?.pricePerGram ?? 0)
          return { label: `${filament?.name ?? '—'} (${r.label})`, grams, cost }
        })
    })
    .filter((g) => g.grams > 0)
  const gastoTotalGrams = gastoRows.reduce((sum, g) => sum + g.grams, 0)
  const gastoTotalCost = gastoRows.reduce((sum, g) => sum + g.cost, 0)

  async function individualAction() {
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
      if (!row.date || !row.printerId || row.filaments.some((f) => !f.filamentId) || !row.quantityPlanned || !row.quantitySuccess) {
        alert(`Preencha data, impressora, filamento, planejada e sucesso de "${row.label}"`)
        return
      }
    }

    const fd = new FormData()
    fd.set('productId', productId)
    fd.set(
      'itemsJson',
      JSON.stringify(
        checkedRows.map((r) => ({
          productPartId: r.key === 'product' ? null : r.key,
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
    const result = await createProductionRunBatch(fd)
    if (!result.success) {
      alert(result.error)
      return
    }
    onOpenChange(false)
    resetAll()
    router.refresh()
  }

  async function plateAction() {
    if (!plateDate || !platePrinterId) {
      alert('Preencha data e impressora da Plate')
      return
    }
    if (plateItems.length === 0) {
      alert('Adicione ao menos uma peça à Plate')
      return
    }
    for (const item of plateItems) {
      if (item.filaments.some((f) => !f.filamentId) || !item.quantityPlanned || !item.quantitySuccess) {
        alert(`Preencha filamento, planejada e sucesso de "${item.partName}"`)
        return
      }
    }

    const fd = new FormData()
    fd.set('date', plateDate)
    fd.set('printerId', platePrinterId)
    fd.set('notes', plateNotes || '')
    fd.set(
      'itemsJson',
      JSON.stringify(
        plateItems.map((item) => ({
          productId: item.productId,
          productPartId: item.partId,
          quantityPlanned: parseInt(item.quantityPlanned, 10),
          quantitySuccess: parseInt(item.quantitySuccess, 10),
          filaments: item.filaments.map((f) => ({
            filamentId: f.filamentId,
            weightGramsPerUnit: parseFloat(f.weightGramsPerUnit) || 0,
            gramsWasted: parseFloat(f.gramsWasted) || 0,
          })),
          timeWastedHours: parseFloat(item.timeWastedHours) || 0,
          wasteReason: item.wasteReason || null,
          notes: item.notes || null,
        })),
      ),
    )
    if (usedCaptureId) fd.set('printerCaptureId', usedCaptureId)
    if (plateActualPrintTimeHours !== null) fd.set('actualPrintTimeHours', String(plateActualPrintTimeHours))
    const result = await createPlate(fd)
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
      className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form action={mode === 'individual' ? individualAction : plateAction} className="grid gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Registrar produção</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>

        <label className="text-sm">
          Modo de produção
          <select
            value={mode}
            onChange={(e) => { setMode(e.target.value as 'individual' | 'plate'); setProductId(''); setRows([]); setPlateItems([]) }}
            className="tk-input-full"
          >
            <option value="individual">Produção individual</option>
            <option value="plate">Adicionar a uma Plate (impressão simultânea)</option>
          </select>
        </label>

        {mode === 'individual' ? (
          <>
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
                            Data
                            <input type="date" value={row.date} onChange={(e) => updateRow(row.key, { date: e.target.value })} className="tk-input-full" disabled={!row.checked} required />
                          </label>
                          <label className="text-xs">
                            Impressora
                            <select value={row.printerId} onChange={(e) => updateRow(row.key, { printerId: e.target.value })} className="tk-input-full" disabled={!row.checked}>
                              <option value="" disabled>Selecione</option>
                              {printers.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs">
                            Tempo por unidade (HH:MM)
                            <HoursInput
                              value={row.printTimeHoursPerUnit}
                              onChange={(hours) => updateRow(row.key, { printTimeHoursPerUnit: hours })}
                              className="tk-input-full"
                            />
                          </label>
                          {row.filaments.length === 1 && (
                            <FilamentEditor
                              filaments={row.filaments}
                              filamentOptions={filaments}
                              onChange={(i, patch) => updateRowFilament(row.key, i, patch)}
                              disabled={!row.checked}
                            />
                          )}
                        </div>

                        {row.filaments.length > 1 && (
                          <FilamentEditor
                            filaments={row.filaments}
                            filamentOptions={filaments}
                            onChange={(i, patch) => updateRowFilament(row.key, i, patch)}
                            disabled={!row.checked}
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
              </div>
            )}
          </>
        ) : (
          <>
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              Plate = várias peças impressas JUNTAS na mesma impressão física (mesma data/impressora), mesmo que de produtos diferentes.
              O custo de impressora (depreciação, manutenção, energia) é rateado entre elas proporcionalmente ao tempo × quantidade de
              cada peça; o custo de filamento continua 100% por peça.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                Data da Plate
                <input type="date" value={plateDate} onChange={(e) => setPlateDate(e.target.value)} className="tk-input-full" required />
              </label>
              <label className="text-xs">
                Impressora da Plate
                <select value={platePrinterId} onChange={(e) => setPlatePrinterId(e.target.value)} className="tk-input-full" required>
                  <option value="" disabled>Selecione</option>
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {availableCapture && (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-900/20">
                <p>
                  Impressão dessa impressora terminou às {new Date(availableCapture.finishedAt).toLocaleTimeString('pt-BR')}, durou{' '}
                  {availableCapture.durationHours.toFixed(2)}h
                  {availableCapture.gramsUsedTotal !== null && `, ~${availableCapture.gramsUsedTotal.toFixed(1)}g de filamento`}.
                </p>
                <button
                  type="button"
                  className="mt-1 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  onClick={() => {
                    const autofill = buildPlateAutofill(
                      { durationHours: availableCapture.durationHours, gramsUsedTotal: availableCapture.gramsUsedTotal, outcome: availableCapture.outcome },
                      plateItems.map((item) => {
                        const perUnit = parseFloat(item.filaments[0]?.weightGramsPerUnit ?? '0') || 0
                        const qty = parseInt(item.quantityPlanned, 10) || 0
                        return { key: item.key, theoreticalGramsUsed: perUnit * qty }
                      }),
                    )
                    setPlateActualPrintTimeHours(autofill.actualPrintTimeHours)
                    setPlateItems((rows) =>
                      rows.map((row) => {
                        const timeWasted = autofill.timeWastedHoursByItem[row.key]
                        const gramsWasted = autofill.gramsWastedByItem[row.key]
                        return {
                          ...row,
                          timeWastedHours: timeWasted !== undefined ? String(timeWasted) : row.timeWastedHours,
                          filaments:
                            gramsWasted !== undefined && row.filaments.length === 1
                              ? [{ ...row.filaments[0], gramsWasted: String(gramsWasted) }]
                              : row.filaments,
                        }
                      }),
                    )
                    setUsedCaptureId(availableCapture.id)
                  }}
                >
                  Usar esses dados
                </button>
              </div>
            )}

            <label className="text-xs">
              Observações da Plate (opcional)
              <textarea value={plateNotes} onChange={(e) => setPlateNotes(e.target.value)} className="tk-input-full" rows={1} />
            </label>

            <div className="rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-700">
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Adicionar peça à Plate</p>
              <label className="text-xs">
                Produto
                <select value={addProductId} onChange={(e) => void handleAddProductChange(e.target.value)} className="tk-input-full">
                  <option value="" disabled>Selecione</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              {addProductParts && addProductParts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {addProductParts.map((part) => (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => addPlateItem(part)}
                      className="rounded-lg border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-500/10"
                    >
                      + {part.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {plateItems.length > 0 && (
              <div className="max-h-[40vh] space-y-3 overflow-y-auto pr-1">
                {plateItems.map((item) => {
                  const failed = failedFor(item)
                  const planned = parseInt(item.quantityPlanned, 10) || 0
                  return (
                    <div key={item.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium">{item.partName} <span className="font-normal text-slate-500 dark:text-slate-400">({item.productName})</span></span>
                        <button type="button" onClick={() => removePlateItem(item.key)} className="text-xs text-red-600 hover:underline dark:text-red-400">Remover</button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <label className="text-xs">
                          Tempo por unidade (HH:MM)
                          <HoursInput
                            value={item.printTimeHoursPerUnit}
                            onChange={(hours) => updatePlateItem(item.key, { printTimeHoursPerUnit: hours })}
                            className="tk-input-full"
                          />
                        </label>
                        {item.filaments.length === 1 && (
                          <FilamentEditor
                            filaments={item.filaments}
                            filamentOptions={filaments}
                            onChange={(i, patch) => updatePlateItemFilament(item.key, i, patch)}
                          />
                        )}
                      </div>

                      {item.filaments.length > 1 && (
                        <FilamentEditor
                          filaments={item.filaments}
                          filamentOptions={filaments}
                          onChange={(i, patch) => updatePlateItemFilament(item.key, i, patch)}
                        />
                      )}

                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <label className="text-xs">
                          Planejada
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={item.quantityPlanned}
                            onChange={(e) => updatePlateItem(item.key, { quantityPlanned: e.target.value })}
                            className="tk-input-full"
                          />
                        </label>
                        <label className="text-xs">
                          Sucesso
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={item.quantitySuccess}
                            onChange={(e) => updatePlateItem(item.key, { quantitySuccess: e.target.value })}
                            className="tk-input-full"
                          />
                        </label>
                        <label className="text-xs">
                          Falhas (auto)
                          <input type="number" value={failed} disabled className="tk-input-full opacity-60" />
                        </label>
                      </div>

                      {planned > 0 && failed > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-medium text-amber-600 dark:text-amber-400">Detalhes do desperdício (opcional)</summary>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {item.filaments.length === 1 && (
                              <label className="text-xs">
                                Filamento desperdiçado (g)
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.filaments[0].gramsWasted}
                                  onChange={(e) => updatePlateItemFilament(item.key, 0, { gramsWasted: e.target.value })}
                                  className="tk-input-full"
                                />
                              </label>
                            )}
                            <label className="text-xs">
                              Tempo desperdiçado (HH:MM)
                              <HoursInput value={parseFloat(item.timeWastedHours) || 0} onChange={(hours) => updatePlateItem(item.key, { timeWastedHours: String(hours) })} className="tk-input-full" />
                            </label>
                            <label className="text-xs">
                              Motivo (opcional)
                              <select value={item.wasteReason} onChange={(e) => updatePlateItem(item.key, { wasteReason: e.target.value })} className="tk-input-full">
                                <option value="">Nenhum</option>
                                {WASTE_REASON_OPTIONS.map((reason) => (
                                  <option key={reason} value={reason}>{WASTE_REASON_LABELS[reason]}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs">
                              Observações (opcional)
                              <textarea value={item.notes} onChange={(e) => updatePlateItem(item.key, { notes: e.target.value })} className="tk-input-full" rows={1} />
                            </label>
                          </div>
                        </details>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {gastoRows.length > 0 && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <p className="mb-1 font-medium text-slate-700 dark:text-slate-300">Gasto por peça</p>
            <dl className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {gastoRows.map((g, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <dt>{g.label}</dt>
                  <dd className="tabular-nums">{g.grams}g · R$ {g.cost.toFixed(2)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
              <dt>Gasto total</dt>
              <dd className="tabular-nums">{gastoTotalGrams}g · R$ {gastoTotalCost.toFixed(2)}</dd>
            </div>
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
          <SubmitButton pendingLabel="Salvando…">Registrar produção</SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
