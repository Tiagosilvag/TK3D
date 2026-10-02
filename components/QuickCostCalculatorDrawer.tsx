'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import { calculateQuickEstimate } from '@/lib/quickCalc'
import { getQuickCalculatorData, createProductFromQuickCalc, type QuickCalculatorData } from '@/actions/quickCalculator'
import { NavCalculatorIcon } from '@/components/NavIcons'

const WEIGHT_PRESETS_GRAMS = [5, 10, 20, 50, 100]
const TIME_PRESETS_MIN = [15, 30, 60, 120, 240]
const LABOR_PRESETS_MIN = [5, 10, 15, 30]
const DEFAULT_WEIGHT_GRAMS = 10
const DEFAULT_PRINT_TIME_HOURS = 1
const AVERAGE_PRINTER_CHOICE = 'AVERAGE'

type SelectedItem = { kind: 'supply' | 'accessory'; id: string; name: string; unitCost: number; quantity: number; unit?: string }

function chipClass(active: boolean): string {
  return `rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white dark:from-violet-500 dark:to-blue-500 dark:text-slate-950'
      : 'border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
  }`
}

function Stepper({ value, onChange, step, min = 0, format }: { value: number; onChange: (v: number) => void; step: number; min?: number; format: (v: number) => string }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(min, Math.round((value - step) * 1000) / 1000))} className="tk-input h-7 w-7 shrink-0 text-center leading-none">−</button>
      <span className="min-w-[4.5rem] text-center text-sm font-medium tabular-nums">{format(value)}</span>
      <button type="button" onClick={() => onChange(Math.round((value + step) * 1000) / 1000)} className="tk-input h-7 w-7 shrink-0 text-center leading-none">+</button>
    </div>
  )
}

function formatGrams(v: number): string {
  return `${v}g`
}

function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

// Melhoria "Calculadora rápida de custo de produto": gaveta global (acessível
// de qualquer tela via botão na barra lateral, ver AppLayoutClient.tsx) pra
// estimar o custo de produção com o mínimo de digitação possível -- tudo
// chip/stepper sobre catálogo já cadastrado (Filamento/Insumos/Acessórios),
// nunca navega pra outra página. Dados buscados sob demanda na abertura
// (não no layout, que persiste entre navegações e deixaria o catálogo
// obsoleto depois de qualquer edição feita em outra tela/sessão).
export function QuickCostCalculatorButton() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<QuickCalculatorData | null>(null)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [isPending, startTransition] = useTransition()

  const [filamentId, setFilamentId] = useState<string | null>(null)
  const [weightGrams, setWeightGrams] = useState(DEFAULT_WEIGHT_GRAMS)
  const [printTimeHours, setPrintTimeHours] = useState(DEFAULT_PRINT_TIME_HOURS)
  const [laborTimeHours, setLaborTimeHours] = useState(5 / 60)
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])

  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [productName, setProductName] = useState('')
  const [productCategory, setProductCategory] = useState('')
  const [printerChoice, setPrinterChoice] = useState(AVERAGE_PRINTER_CHOICE)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    getQuickCalculatorData()
      .then((result) => {
        setData(result)
        setLaborTimeHours((prev) => (prev === 5 / 60 ? result.defaultLaborTimeHours : prev))
      })
      .finally(() => setLoading(false))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  function resetToDefaults() {
    setFilamentId(null)
    setWeightGrams(DEFAULT_WEIGHT_GRAMS)
    setPrintTimeHours(DEFAULT_PRINT_TIME_HOURS)
    setLaborTimeHours(data?.defaultLaborTimeHours ?? 5 / 60)
    setSelectedItems([])
    setShowRegisterForm(false)
    setProductName('')
    setProductCategory('')
    setPrinterChoice(AVERAGE_PRINTER_CHOICE)
    setFormError(null)
  }

  function close() {
    setIsOpen(false)
  }

  function addItem(kind: 'supply' | 'accessory', opt: { id: string; name: string; unitCost: number; unit?: string; defaultUsage?: number | null }) {
    setSelectedItems((prev) => {
      if (prev.some((i) => i.kind === kind && i.id === opt.id)) return prev
      return [...prev, { kind, id: opt.id, name: opt.name, unitCost: opt.unitCost, quantity: opt.defaultUsage ?? 1, unit: opt.unit }]
    })
  }

  function removeItem(kind: 'supply' | 'accessory', id: string) {
    setSelectedItems((prev) => prev.filter((i) => !(i.kind === kind && i.id === id)))
  }

  function updateItemQuantity(kind: 'supply' | 'accessory', id: string, quantity: number) {
    setSelectedItems((prev) => prev.map((i) => (i.kind === kind && i.id === id ? { ...i, quantity } : i)))
  }

  const filament = data?.filaments.find((f) => f.id === filamentId) ?? null
  const suppliesAndAccessoriesCost = selectedItems.reduce((sum, i) => sum + i.quantity * i.unitCost, 0)

  const breakdown = calculateQuickEstimate({
    weightGrams,
    filamentPricePerGram: filament?.pricePerGram ?? 0,
    printTimeHours,
    printerCostPerHour: data?.averagePrinterCostPerHour ?? 0,
    suppliesAndAccessoriesCost,
    laborTimeHours,
    laborCostPerHour: data?.laborCostPerHour ?? 0,
  })

  const chosenPrinter = data?.printers.find((p) => p.id === printerChoice) ?? null
  const registerPrinterCostPerHour = printerChoice === AVERAGE_PRINTER_CHOICE ? (data?.averagePrinterCostPerHour ?? 0) : chosenPrinter?.costPerHour ?? 0
  const registerBreakdown =
    printerChoice === AVERAGE_PRINTER_CHOICE
      ? breakdown
      : calculateQuickEstimate({
          weightGrams,
          filamentPricePerGram: filament?.pricePerGram ?? 0,
          printTimeHours,
          printerCostPerHour: registerPrinterCostPerHour,
          suppliesAndAccessoriesCost,
          laborTimeHours,
          laborCostPerHour: data?.laborCostPerHour ?? 0,
        })

  function handleCreateProduct() {
    if (!filamentId) return setFormError('Selecione um filamento.')
    if (!productName.trim()) return setFormError('Informe o nome do produto.')
    if (!productCategory.trim()) return setFormError('Informe a categoria.')
    setFormError(null)
    startTransition(async () => {
      const result = await createProductFromQuickCalc({
        name: productName.trim(),
        category: productCategory.trim(),
        filamentId,
        weightGrams,
        printerId: printerChoice === AVERAGE_PRINTER_CHOICE ? null : printerChoice,
        printTimeHours,
        laborTimeHours,
        supplyUsages: selectedItems.filter((i) => i.kind === 'supply').map((i) => ({ id: i.id, quantity: i.quantity })),
        accessoryUsages: selectedItems.filter((i) => i.kind === 'accessory').map((i) => ({ id: i.id, quantity: i.quantity })),
      })
      if (!result.success) {
        setFormError(result.error ?? 'Erro ao criar produto.')
        return
      }
      close()
      resetToDefaults()
      router.refresh()
      if (result.productId) router.push(`/products/${result.productId}`)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 font-display text-base font-semibold text-violet-700 transition-colors hover:bg-violet-100 max-md:py-3 dark:text-violet-300 dark:hover:bg-violet-500/10"
      >
        <NavCalculatorIcon className="h-5 w-5 shrink-0" />
        Calculadora rápida
      </button>

      {mounted && isOpen && createPortal(
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" onClick={close}>
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white text-slate-900 shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h3 className="font-display text-base font-semibold">Calculadora rápida de custo</h3>
              <button type="button" onClick={close} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading || !data ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">Carregando...</p>
              ) : (
                <div className="space-y-5">
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Filamento</p>
                      {data.filaments.length === 0 && <span className="text-xs text-amber-600 dark:text-amber-400">Nenhum cadastrado</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {data.filaments.map((f) => (
                        <button key={f.id} type="button" onClick={() => setFilamentId(f.id)} className={`flex items-center gap-1.5 ${chipClass(filamentId === f.id)}`}>
                          {f.colorHex && <span style={{ background: f.colorHex }} className="inline-block h-2 w-2 shrink-0 rounded-full" />}
                          {f.name}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="flex flex-wrap gap-1">
                        {WEIGHT_PRESETS_GRAMS.map((g) => (
                          <button key={g} type="button" onClick={() => setWeightGrams(g)} className={chipClass(weightGrams === g)}>{g}g</button>
                        ))}
                      </div>
                      <Stepper value={weightGrams} onChange={setWeightGrams} step={1} min={1} format={formatGrams} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Custo filamento: {formatCurrency(breakdown.filamentCost)}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Tempo de impressão</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <div className="flex flex-wrap gap-1">
                        {TIME_PRESETS_MIN.map((m) => (
                          <button key={m} type="button" onClick={() => setPrintTimeHours(m / 60)} className={chipClass(Math.round(printTimeHours * 60) === m)}>{formatDuration(m / 60)}</button>
                        ))}
                      </div>
                      <Stepper value={printTimeHours} onChange={setPrintTimeHours} step={15 / 60} min={15 / 60} format={formatDuration} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                      Custo impressora (média {data.printers.length} cadastrada{data.printers.length === 1 ? '' : 's'}): {formatCurrency(breakdown.printerCost)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Insumos e acessórios</p>
                    <div className="mt-1 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                      {data.supplies.filter((s) => !selectedItems.some((i) => i.kind === 'supply' && i.id === s.id)).map((s) => (
                        <button key={s.id} type="button" onClick={() => addItem('supply', { id: s.id, name: s.name, unitCost: s.unitCost, unit: s.unit, defaultUsage: s.defaultUsage })} className={chipClass(false)}>
                          + {s.name}
                        </button>
                      ))}
                      {data.accessories.filter((a) => !selectedItems.some((i) => i.kind === 'accessory' && i.id === a.id)).map((a) => (
                        <button key={a.id} type="button" onClick={() => addItem('accessory', { id: a.id, name: a.name, unitCost: a.unitCost })} className={chipClass(false)}>
                          + {a.name}
                        </button>
                      ))}
                    </div>
                    {selectedItems.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {selectedItems.map((i) => (
                          <div key={`${i.kind}-${i.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
                            <span className="min-w-0 flex-1 truncate text-sm">{i.name}</span>
                            <Stepper value={i.quantity} onChange={(v) => updateItemQuantity(i.kind, i.id, v)} step={i.kind === 'supply' ? 0.1 : 1} min={0.1} format={(v) => (i.unit ? `${v}${i.unit.toLowerCase()}` : String(v))} />
                            <button type="button" onClick={() => removeItem(i.kind, i.id)} className="shrink-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Custo insumos/acessórios: {formatCurrency(breakdown.suppliesAndAccessoriesCost)}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Mão de obra ({formatCurrency(data.laborCostPerHour)}/h, definido em Configurações)</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <div className="flex flex-wrap gap-1">
                        {LABOR_PRESETS_MIN.map((m) => (
                          <button key={m} type="button" onClick={() => setLaborTimeHours(m / 60)} className={chipClass(Math.round(laborTimeHours * 60) === m)}>{m}min</button>
                        ))}
                      </div>
                      <Stepper value={laborTimeHours} onChange={setLaborTimeHours} step={5 / 60} min={0} format={formatDuration} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Custo mão de obra: {formatCurrency(breakdown.laborCost)}</p>
                  </div>

                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-500/10">
                    <p className="text-xs font-medium text-violet-700 dark:text-violet-300">Custo total estimado</p>
                    <p className="text-2xl font-semibold tabular-nums text-violet-900 dark:text-violet-200">{formatCurrency(breakdown.total)}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={resetToDefaults} className="tk-input px-3 py-1.5 text-xs">Limpar</button>
                    <button type="button" onClick={() => setShowRegisterForm((v) => !v)} className="tk-btn-primary px-3 py-1.5 text-xs">
                      {showRegisterForm ? 'Fechar cadastro' : 'Cadastrar como produto'}
                    </button>
                  </div>

                  {showRegisterForm && (
                    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div>
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Nome</label>
                        <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Ex.: Chaveiro Mini Jesus" className="tk-input-full mt-1" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Categoria</label>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {data.categories.map((c) => (
                            <button key={c} type="button" onClick={() => setProductCategory(c)} className={chipClass(productCategory === c)}>{c}</button>
                          ))}
                        </div>
                        <input value={productCategory} onChange={(e) => setProductCategory(e.target.value)} placeholder="Ou digite uma nova categoria" className="tk-input-full mt-1.5" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Impressora</label>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => setPrinterChoice(AVERAGE_PRINTER_CHOICE)} className={chipClass(printerChoice === AVERAGE_PRINTER_CHOICE)}>Impressora Média (automática)</button>
                          {data.printers.map((p) => (
                            <button key={p.id} type="button" onClick={() => setPrinterChoice(p.id)} className={chipClass(printerChoice === p.id)}>{p.name}</button>
                          ))}
                        </div>
                        {printerChoice === AVERAGE_PRINTER_CHOICE && (
                          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                            Vai usar a &quot;Impressora Média&quot;, calculada automaticamente a partir das impressoras cadastradas -- só um ponto de partida, pode trocar por uma impressora específica quando quiser.
                          </p>
                        )}
                        {printerChoice !== AVERAGE_PRINTER_CHOICE && (
                          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Custo do produto com esta impressora: {formatCurrency(registerBreakdown.total)}</p>
                        )}
                      </div>
                      {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
                      <button type="button" onClick={handleCreateProduct} disabled={isPending} className="tk-btn-primary w-full py-1.5 text-sm">
                        {isPending ? 'Criando...' : 'Criar produto'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
