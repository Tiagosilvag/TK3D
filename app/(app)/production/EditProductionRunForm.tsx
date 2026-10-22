'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateProductionRunFull, deleteProductionRun, type ProductionRunEditData, type ProductionRunLogRow } from '@/actions/productionRuns'
import { WASTE_REASON_LABELS } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import { HoursInput } from '@/components/HoursInput'
import { FilamentSelect, AddColorsButton, type FilamentFormOption } from '@/components/FilamentSelect'
import { stashProductionUndo } from './productionUndo'
import type { WasteReason } from '@prisma/client'

const WASTE_REASON_OPTIONS = Object.keys(WASTE_REASON_LABELS) as WasteReason[]
const grams = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} g`

interface Row {
  filamentId: string
  weight: string // gramas por unidade
  wasted: string // gramas desperdiçadas (total)
}

// Edição COMPLETA de uma produção já registrada (data, impressora, filamentos,
// quantidades, desperdício). Produto e peça ficam fixos -- pra mudar, exclua e
// registre de novo. O servidor recalcula tudo pela diferença (estoque por
// rolo, custo, status, montagens e pedidos) e devolve o estado anterior, usado
// no "Desfazer" mostrado na lista ao voltar.
export function EditProductionRunForm({
  data,
  printers,
  filaments,
  returnTo,
  logs,
}: {
  data: ProductionRunEditData
  printers: { id: string; name: string }[]
  filaments: FilamentFormOption[]
  returnTo: string
  logs: ProductionRunLogRow[]
}) {
  const router = useRouter()
  const [date, setDate] = useState(data.date)
  const [printerId, setPrinterId] = useState(data.printerId)
  const [timeWasted, setTimeWasted] = useState(data.timeWastedHours)
  const [wasteReason, setWasteReason] = useState(data.wasteReason ?? '')
  const [notes, setNotes] = useState(data.notes ?? '')
  const [planned, setPlanned] = useState(String(data.quantityPlanned))
  const [success, setSuccess] = useState(String(data.quantitySuccess))
  const [successTouched, setSuccessTouched] = useState(false)
  const [rows, setRows] = useState<Row[]>(
    data.filaments.map((f) => ({ filamentId: f.filamentId, weight: String(Math.round(f.weightGramsPerUnit * 1000) / 1000), wasted: String(f.gramsWasted) })),
  )
  const [error, setError] = useState<string | null>(null)

  const plannedNum = parseInt(planned, 10) || 0
  const successNum = parseInt(success, 10) || 0
  const failedNum = Math.max(0, plannedNum - successNum)
  const optionById = useMemo(() => new Map(filaments.map((f) => [f.id, f])), [filaments])

  // Consumo ANTES da edição, por rolo: o que a própria produção devolve
  // conta como disponível ao comparar com o estoque.
  const oldByFilament = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of data.filaments) m.set(f.filamentId, (m.get(f.filamentId) ?? 0) + f.weightGramsPerUnit * data.quantityPlanned + f.gramsWasted)
    return m
  }, [data])

  // Consumo NOVO por rolo, somando todas as linhas que usam o mesmo rolo.
  const newByFilament = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      if (!r.filamentId) continue
      m.set(r.filamentId, (m.get(r.filamentId) ?? 0) + (parseFloat(r.weight) || 0) * plannedNum + (parseFloat(r.wasted) || 0))
    }
    return m
  }, [rows, plannedNum])

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  function onPlannedChange(value: string) {
    setPlanned(value)
    // Sucesso acompanha o planejado até ser editado à mão.
    if (!successTouched) setSuccess(value)
  }

  async function save(formData: FormData) {
    void formData
    setError(null)
    if (rows.some((r) => !r.filamentId)) return setError('Selecione o filamento.')
    const result = await updateProductionRunFull(data.id, {
      date,
      printerId,
      printTimeHoursPerUnit: data.printTimeHoursPerUnit,
      timeWastedHours: timeWasted,
      wasteReason: wasteReason || null,
      notes: notes || null,
      quantityPlanned: plannedNum,
      quantitySuccess: successNum,
      filaments: rows.map((r) => ({ filamentId: r.filamentId, weightGramsPerUnit: parseFloat(r.weight) || 0, gramsWasted: parseFloat(r.wasted) || 0 })),
    })
    if (!result.success) return setError(result.error ?? 'Erro ao salvar.')
    if (result.previous) stashProductionUndo({ runId: data.id, previous: result.previous, message: 'Produção atualizada.' })
    router.push(returnTo)
  }

  async function remove() {
    // Sem janela de confirmação: o "Desfazer" (10 s, na lista) recria a produção.
    const result = await deleteProductionRun(data.id)
    if (!result.success) return setError(result.error ?? 'Erro ao excluir.')
    if (result.restorable) stashProductionUndo({ kind: 'restore', data: result.restorable, message: 'Produção excluída.' })
    router.push(returnTo)
  }

  return (
    <form action={save} className="mb-4 tk-panel space-y-4 p-4">
      <div>
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
          Editar produção · {data.productName}{data.partName ? ` · ${data.partName}` : ''}
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Tudo pode ser corrigido: estoque por rolo, custo, status e pendências são recalculados pela diferença. Produto e peça ficam fixos
          (para mudar, exclua e registre de novo).{data.plateId ? ' Faz parte de uma Plate: o tempo de impressão rateado é mantido.' : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="text-sm">
          Data
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Impressora
          <select value={printerId} onChange={(e) => setPrinterId(e.target.value)} className="tk-input-full">
            {printers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Planejada
          <input type="number" min={1} value={planned} onChange={(e) => onPlannedChange(e.target.value)} autoFocus onFocus={(e) => e.target.select()} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Sucesso
          <input type="number" min={0} max={plannedNum} value={success} onChange={(e) => { setSuccessTouched(true); setSuccess(e.target.value) }} className="tk-input-full" required />
        </label>
        <div className="text-sm">
          <span className="block">Falhas</span>
          <span className={`mt-1 block rounded-lg border border-slate-200 px-3 py-2 tabular-nums dark:border-slate-700 ${failedNum > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{failedNum}</span>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filamento(s) desta peça · gramas por unidade</span>
        {rows.map((r, i) => {
          const opt = optionById.get(r.filamentId)
          const stock = (opt?.stockGrams ?? 0) + (oldByFilament.get(r.filamentId) ?? 0)
          const usage = newByFilament.get(r.filamentId) ?? 0
          const short = r.filamentId !== '' && usage > stock + 1e-9
          const pricePerGram = opt?.pricePerGram ?? 0
          return (
            <div key={i}>
              <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-[1fr_7rem_7rem_6rem_auto]">
                <label className="col-span-2 text-xs md:col-span-1">
                  Filamento *
                  <FilamentSelect
                    options={filaments}
                    value={r.filamentId}
                    onChange={(id) => updateRow(i, { filamentId: id })}
                    need={(parseFloat(r.weight) || 0) * plannedNum + (parseFloat(r.wasted) || 0)}
                    contextIds={rows.filter((_, j) => j !== i).map((x) => x.filamentId).filter(Boolean)}
                    contextLabel={data.partName ?? data.productName}
                  />
                </label>
                <label className="text-xs">
                  Gramas por unidade
                  <input type="number" step="0.01" min="0" value={r.weight} onChange={(e) => updateRow(i, { weight: e.target.value })} className="tk-input-full" />
                </label>
                <label className="text-xs">
                  Desperdício (g)
                  <input type="number" step="0.01" min="0" value={r.wasted} onChange={(e) => updateRow(i, { wasted: e.target.value })} className="tk-input-full" />
                </label>
                <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  <span className="block">Custo/un.</span>
                  <span className="mt-2 block">{pricePerGram ? `R$ ${((parseFloat(r.weight) || 0) * pricePerGram).toFixed(2)}` : '—'}</span>
                </div>
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} aria-label="Remover cor" className="pb-2 text-slate-400 hover:text-red-600">✕</button>
                )}
              </div>
              {r.filamentId && (
                <p className={`mt-1 text-xs ${short ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {short ? `Não cobre: usa ${grams(usage)} e o rolo tem ${grams(stock)}.` : `Usa ${grams(usage)} · sobram ${grams(stock - usage)}`}
                </p>
              )}
            </div>
          )
        })}
        <AddColorsButton
          options={filaments}
          onAdd={(ids) => setRows((prev) => [...prev, ...ids.map((filamentId) => ({ filamentId, weight: '0', wasted: '0' }))])}
          contextIds={rows.map((r) => r.filamentId).filter(Boolean)}
          contextLabel={data.partName ?? data.productName}
          className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
        >
          + Adicionar outra cor (impressão multi-material)
        </AddColorsButton>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="text-sm">
          Tempo desperdiçado (HH:MM)
          <HoursInput value={timeWasted} onChange={setTimeWasted} />
        </label>
        <label className="text-sm">
          Motivo do desperdício
          <select value={wasteReason} onChange={(e) => setWasteReason(e.target.value)} className="tk-input-full">
            <option value="">Nenhum</option>
            {WASTE_REASON_OPTIONS.map((reason) => (
              <option key={reason} value={reason}>{WASTE_REASON_LABELS[reason]}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-sm">
          Observações
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="tk-input-full" rows={2} />
        </label>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>
        <Link href={returnTo} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</Link>
        <button type="button" onClick={() => void remove()} className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10">
          Excluir produção
        </button>
      </div>

      {logs.length > 0 && (
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Registro de alterações</h3>
          <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
            {logs.map((l) => (
              <li key={l.id}>
                <span className="tabular-nums text-slate-400 dark:text-slate-500">{new Date(l.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                {' · '}{l.summary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}
