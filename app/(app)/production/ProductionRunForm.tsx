'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createProductionRun, updateProductionRun } from '@/actions/productionRuns'
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

function formatHours(hours: number): string {
  return `${hours.toFixed(2)}h`
}

type EditingRun = {
  id: string
  productName: string
  printerName: string
  filamentName: string
  date: string
  quantityPlanned: number
  quantitySuccess: number
  quantityFailed: number
  gramsUsed: number
  gramsWasted: number
  timeWastedHours: number
  wasteReason: string | null
  notes: string | null
}

export function ProductionRunForm({
  products,
  printers,
  filaments,
  editingRun,
}: {
  products: Option[]
  printers: Option[]
  filaments: Option[]
  editingRun?: EditingRun
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [quantityFailed, setQuantityFailed] = useState(editingRun ? String(editingRun.quantityFailed) : '')
  const [timeWastedHours, setTimeWastedHours] = useState(editingRun ? String(editingRun.timeWastedHours) : '0')

  // Bug 3: selecionar um produto busca sua ficha técnica e pré-preenche
  // impressora/filamento/"Filamento usado (g)" — tudo continua editável,
  // é só um ponto de partida. 2.1: produto composto não tem UM
  // filamento/peso — em vez disso pede pra escolher qual peça está sendo
  // produzida, e autopreenche a partir da peça escolhida.
  const [productId, setProductId] = useState('')
  const [printerId, setPrinterId] = useState('')
  const [filamentId, setFilamentId] = useState('')
  const [quantityPlanned, setQuantityPlanned] = useState('')
  const [gramsUsed, setGramsUsed] = useState('')
  const [expectedPrintTimeHours, setExpectedPrintTimeHours] = useState<number | null>(null)
  const [productWeightGrams, setProductWeightGrams] = useState<number | null>(null)
  const [isCompositeProduct, setIsCompositeProduct] = useState(false)
  const [productParts, setProductParts] = useState<ProductProductionPartDefault[]>([])
  const [productPartId, setProductPartId] = useState('')
  // Ajuste "peça multi-filamento": preenchido só quando a peça escolhida
  // tem >1 componente de filamento na receita -- nesse caso o único
  // seletor de filamento/peso vira N linhas (uma por cor), e o formulário
  // envia um filamentUsagesJson em vez dos campos escalares filamentId/
  // gramsUsed. Vazio (a maioria dos casos) = formulário de sempre, sem
  // mudança nenhuma.
  const [partFilamentRows, setPartFilamentRows] = useState<
    { filamentId: string; unitWeightGrams: number; gramsUsed: string; gramsWasted: string }[]
  >([])

  function applyWeightAndTime(weightGrams: number, printTimeHours: number) {
    setExpectedPrintTimeHours(printTimeHours)
    setProductWeightGrams(weightGrams)
    const qty = parseFloat(quantityPlanned) || 1
    setGramsUsed(String(weightGrams * qty))
  }

  async function handleProductChange(newProductId: string) {
    setProductId(newProductId)
    setProductPartId('')
    setPrinterId('')
    setFilamentId('')
    if (!newProductId) {
      setIsCompositeProduct(false)
      setProductParts([])
      setExpectedPrintTimeHours(null)
      setProductWeightGrams(null)
      return
    }
    try {
      const defaults = await getProductProductionDefaults(newProductId)
      if (defaults.isComposite) {
        setIsCompositeProduct(true)
        setProductParts(defaults.parts ?? [])
        setExpectedPrintTimeHours(null)
        setProductWeightGrams(null)
      } else {
        setIsCompositeProduct(false)
        setProductParts([])
        setPrinterId(defaults.printerId ?? '')
        setFilamentId(defaults.filamentId ?? '')
        applyWeightAndTime(defaults.weightGrams ?? 0, defaults.printTimeHours ?? 0)
      }
    } catch {
      // Produto sem dados carregáveis não deve travar o preenchimento manual.
    }
  }

  function handlePartChange(newPartId: string) {
    setProductPartId(newPartId)
    const part = productParts.find((p) => p.id === newPartId)
    if (!part) return
    setPrinterId(part.printerId)
    setExpectedPrintTimeHours(part.printTimeHours)
    const qty = parseFloat(quantityPlanned) || 1
    if (part.filaments.length <= 1) {
      const only = part.filaments[0]
      setFilamentId(only?.filamentId ?? '')
      setProductWeightGrams(only?.weightGrams ?? 0)
      setGramsUsed(String((only?.weightGrams ?? 0) * qty))
      setPartFilamentRows([])
    } else {
      setFilamentId('')
      setProductWeightGrams(null)
      setGramsUsed('')
      setPartFilamentRows(
        part.filaments.map((f) => ({ filamentId: f.filamentId, unitWeightGrams: f.weightGrams, gramsUsed: String(f.weightGrams * qty), gramsWasted: '0' })),
      )
    }
  }

  function updatePartFilamentRow(index: number, patch: Partial<{ filamentId: string; gramsUsed: string; gramsWasted: string }>) {
    setPartFilamentRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function handleQuantityPlannedChange(value: string) {
    setQuantityPlanned(value)
    const qty = parseFloat(value) || 0
    if (productWeightGrams != null) {
      setGramsUsed(String(productWeightGrams * qty))
    }
    if (partFilamentRows.length > 0) {
      setPartFilamentRows((rows) => rows.map((r) => ({ ...r, gramsUsed: String(r.unitWeightGrams * qty) })))
    }
  }

  async function action(formData: FormData) {
    if (editingRun) {
      const result = await updateProductionRun(editingRun.id, formData)
      if (!result.success) {
        alert(result.error)
        return
      }
      router.push('/production')
      return
    }
    if (isCompositeProduct && productParts.find((p) => p.id === productPartId) && partFilamentRows.length > 0) {
      if (partFilamentRows.some((r) => !r.filamentId || !r.gramsUsed)) {
        alert('Preencha o filamento e o peso usado de cada cor da peça.')
        return
      }
      formData.set('filamentId', partFilamentRows[0].filamentId)
      formData.set('gramsUsed', '0')
      formData.set('gramsWasted', '0')
      formData.set(
        'filamentUsagesJson',
        JSON.stringify(partFilamentRows.map((r) => ({ filamentId: r.filamentId, gramsUsed: parseFloat(r.gramsUsed) || 0, gramsWasted: parseFloat(r.gramsWasted) || 0 }))),
      )
    }

    const result = await createProductionRun(formData)
    if (result.success) {
      formRef.current?.reset()
      setQuantityFailed('')
      setProductId('')
      setPrinterId('')
      setFilamentId('')
      setQuantityPlanned('')
      setGramsUsed('')
      setExpectedPrintTimeHours(null)
      setProductWeightGrams(null)
      setIsCompositeProduct(false)
      setProductParts([])
      setProductPartId('')
      setPartFilamentRows([])
    } else {
      alert(result.error)
    }
  }

  if (editingRun) {
    return (
      <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4">
        <p className="col-span-full text-sm text-slate-500 dark:text-slate-400">
          Produção concluída — quantidade e filamento ficam somente leitura para preservar o histórico. Apenas desperdício e observações podem ser corrigidos.
        </p>
        <div className="text-sm">
          <span className="block text-slate-500 dark:text-slate-400">Produto</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.productName}</span>
        </div>
        <div className="text-sm">
          <span className="block text-slate-500 dark:text-slate-400">Impressora</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.printerName}</span>
        </div>
        <div className="text-sm">
          <span className="block text-slate-500 dark:text-slate-400">Filamento</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.filamentName}</span>
        </div>
        <div className="text-sm">
          <span className="block text-slate-500 dark:text-slate-400">Data</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.date}</span>
        </div>
        <div className="text-sm">
          <span className="block text-slate-500 dark:text-slate-400">Qtd. planejada / sucesso / falhas</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.quantityPlanned} / {editingRun.quantitySuccess} / {editingRun.quantityFailed}</span>
        </div>
        <div className="text-sm">
          <span className="block text-slate-500 dark:text-slate-400">Filamento usado (g)</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.gramsUsed}g</span>
        </div>

        <label className="text-sm">
          Filamento desperdiçado (g)
          <input name="gramsWasted" type="number" step="0.01" min="0" defaultValue={editingRun.gramsWasted} className="tk-input-full" />
        </label>
        <label className="text-sm">
          Tempo desperdiçado (HH:MM)
          <HoursInput name="timeWastedHours" value={parseFloat(timeWastedHours) || 0} onChange={(hours) => setTimeWastedHours(String(hours))} />
        </label>
        <label className="text-sm">
          Motivo do desperdício (opcional)
          <select name="wasteReason" defaultValue={editingRun.wasteReason ?? ''} className="tk-input-full">
            <option value="">Nenhum</option>
            {WASTE_REASON_OPTIONS.map((reason) => (
              <option key={reason} value={reason}>{WASTE_REASON_LABELS[reason]}</option>
            ))}
          </select>
        </label>
        <label className="col-span-full text-sm md:col-span-3">
          Observações (opcional)
          <textarea name="notes" defaultValue={editingRun.notes ?? ''} className="tk-input-full" rows={2} />
        </label>

        <div className="col-span-full mt-2 flex items-center gap-3">
          <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>
          <Link href="/production" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </Link>
        </div>
      </form>
    )
  }

  const failed = parseFloat(quantityFailed) || 0

  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4">
      <label className="text-sm">
        Produto *
        <select
          name="productId"
          value={productId}
          onChange={(e) => void handleProductChange(e.target.value)}
          className="tk-input-full"
          required
        >
          <option value="" disabled>Selecione</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      {isCompositeProduct && (
        <label className="text-sm">
          Peça *
          <select
            name="productPartId"
            value={productPartId}
            onChange={(e) => handlePartChange(e.target.value)}
            className="tk-input-full"
            required
          >
            <option value="" disabled>Selecione a peça</option>
            {productParts.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm">
        Impressora *
        <select name="printerId" value={printerId} onChange={(e) => setPrinterId(e.target.value)} className="tk-input-full" required>
          <option value="" disabled>Selecione</option>
          {printers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      {partFilamentRows.length === 0 && (
        <label className="text-sm">
          Filamento *
          <select name="filamentId" value={filamentId} onChange={(e) => setFilamentId(e.target.value)} className="tk-input-full" required>
            <option value="" disabled>Selecione</option>
            {filaments.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm">
        Data *
        <input name="date" type="date" defaultValue={today()} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Qtd. planejada *
        {expectedPrintTimeHours != null && (
          <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">
            (tempo de impressão esperado: {formatHours(expectedPrintTimeHours * (parseFloat(quantityPlanned) || 1))})
          </span>
        )}
        <input
          name="quantityPlanned"
          type="number"
          step="1"
          min="1"
          value={quantityPlanned}
          onChange={(e) => handleQuantityPlannedChange(e.target.value)}
          className="tk-input-full"
          required
        />
      </label>
      <label className="text-sm">
        Qtd. sucesso *
        <input name="quantitySuccess" type="number" step="1" min="0" className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Qtd. falhas *
        <input
          name="quantityFailed"
          type="number"
          step="1"
          min="0"
          value={quantityFailed}
          onChange={(e) => setQuantityFailed(e.target.value)}
          className="tk-input-full"
          required
        />
      </label>
      {partFilamentRows.length === 0 && (
        <label className="text-sm">
          Filamento usado (g) *
          <input
            name="gramsUsed"
            type="number"
            step="0.01"
            min="0"
            value={gramsUsed}
            onChange={(e) => setGramsUsed(e.target.value)}
            className="tk-input-full"
            required
          />
        </label>
      )}

      {/* Ajuste "peça multi-filamento": a peça escolhida tem >1 cor na
          receita -- uma linha de filamento+peso usado (e desperdiçado) por
          componente, em vez do único par acima. */}
      {partFilamentRows.length > 0 && (
        <div className="col-span-full grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-4">
          <h3 className="col-span-full text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Filamento usado por cor
          </h3>
          {partFilamentRows.map((row, i) => (
            <label key={i} className="text-sm">
              Cor {i + 1} — usado (g) / desperdiçado (g) *
              <select
                value={row.filamentId}
                onChange={(e) => updatePartFilamentRow(i, { filamentId: e.target.value })}
                className="tk-input-full"
                required
              >
                <option value="" disabled>Selecione</option>
                {filaments.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <div className="mt-1 flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.gramsUsed}
                  onChange={(e) => updatePartFilamentRow(i, { gramsUsed: e.target.value })}
                  className="tk-input w-1/2"
                  required
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.gramsWasted}
                  onChange={(e) => updatePartFilamentRow(i, { gramsWasted: e.target.value })}
                  className="tk-input w-1/2"
                />
              </div>
            </label>
          ))}
        </div>
      )}

      {failed > 0 && (
        <div className="col-span-full grid grid-cols-2 gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-500/5 md:grid-cols-4">
          <h3 className="col-span-full text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Detalhes do desperdício
          </h3>
          {partFilamentRows.length === 0 && (
            <label className="text-sm">
              Filamento desperdiçado (g)
              <input name="gramsWasted" type="number" step="0.01" min="0" defaultValue="0" className="tk-input-full" />
            </label>
          )}
          <label className="text-sm">
            Tempo desperdiçado (HH:MM)
            <HoursInput name="timeWastedHours" value={parseFloat(timeWastedHours) || 0} onChange={(hours) => setTimeWastedHours(String(hours))} />
          </label>
          <label className="text-sm">
            Motivo do desperdício (opcional)
            <select name="wasteReason" defaultValue="" className="tk-input-full">
              <option value="">Nenhum</option>
              {WASTE_REASON_OPTIONS.map((reason) => (
                <option key={reason} value={reason}>{WASTE_REASON_LABELS[reason]}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Observações (opcional)
            <textarea name="notes" className="tk-input-full" rows={1} />
          </label>
        </div>
      )}
      {failed <= 0 && (
        <>
          <input type="hidden" name="gramsWasted" value="0" />
          <input type="hidden" name="timeWastedHours" value="0" />
        </>
      )}

      <div className="col-span-full mt-2">
        <SubmitButton pendingLabel="Salvando…">Registrar</SubmitButton>
      </div>
    </form>
  )
}
