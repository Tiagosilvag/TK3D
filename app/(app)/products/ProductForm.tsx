'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProduct, updateProduct } from '@/actions/products'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

type PrinterOption = { id: string; name: string; costPerHour: number }
type FilamentOption = { id: string; name: string; pricePerGram: number }
type PackagingOption = { id: string; name: string; unitCost: number }

const FINISHING_TYPES = [
  { value: 'NENHUM', label: 'Nenhum' },
  { value: 'CANETA_VERNIZ', label: 'Caneta de verniz' },
  { value: 'RESINA_UV', label: 'Resina UV' },
  { value: 'OUTRO', label: 'Outro' },
]

type ProductValues = {
  id: string
  name: string
  category: string
  isComposite: boolean
  printerId: string
  filamentId: string
  weightGrams: number
  printTimeHours: number
  laborTimeHours: number
  packagingItemId: string | null
  finishingType: string
  usesGlue: boolean
  notes: string | null
}

// 2.1 Produto composto: uma linha da lista de peças. `id` presente = peça
// já salva (edição); ausente = peça nova. Campos numéricos ficam como
// string pra serem inputs controlados sem briga de formatação.
type PartRow = {
  id?: string
  name: string
  printerId: string
  filamentId: string
  weightGrams: string
  printTimeHours: string
  quantityPerUnit: string
}

type ExistingPart = {
  id: string
  name: string
  printerId: string
  filamentId: string
  weightGrams: number
  printTimeHours: number
  quantityPerUnit: number
}

function money(value: number): string {
  return formatCurrency(value)
}

function emptyPartRow(): PartRow {
  return { name: '', printerId: '', filamentId: '', weightGrams: '', printTimeHours: '', quantityPerUnit: '1' }
}

export function ProductForm({
  product,
  existingParts,
  printers,
  filaments,
  packagingItems,
  laborCostPerHour,
  currentSuppliesCost = 0,
  currentAccessoriesCost = 0,
  showLiveCostPanel = true,
}: {
  product?: ProductValues
  existingParts?: ExistingPart[]
  printers: PrinterOption[]
  filaments: FilamentOption[]
  packagingItems: PackagingOption[]
  laborCostPerHour: number
  currentSuppliesCost?: number
  currentAccessoriesCost?: number
  // Bug 7: a página de detalhe (/products/[id]) já mostra "Simulação de
  // preço" (usa finalCost com taxa de falha + markup/margem/desconto
  // configuráveis) -- ter os dois painéis lado a lado com fórmulas
  // diferentes (aqui: ×2/×3,3 fixos; lá: Settings-driven) confundia mais do
  // que ajudava. Only a página de criação (/products, sem o painel da
  // direita ainda) continua mostrando este painel.
  showLiveCostPanel?: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  // Campos que alimentam o painel de custo ao vivo (controlados); nome,
  // acabamento, cola e observações não entram no cálculo e ficam
  // não-controlados (defaultValue), como já era antes.
  const [isComposite, setIsComposite] = useState(product?.isComposite ?? false)
  const [printerId, setPrinterId] = useState(product?.printerId ?? '')
  const [filamentId, setFilamentId] = useState(product?.filamentId ?? '')
  const [weightGrams, setWeightGrams] = useState(product ? String(product.weightGrams) : '')
  const [printTimeHours, setPrintTimeHours] = useState(product ? String(product.printTimeHours) : '')
  const [laborTimeHours, setLaborTimeHours] = useState(product ? String(product.laborTimeHours) : '0')
  const [packagingItemId, setPackagingItemId] = useState(product?.packagingItemId ?? '')
  const [parts, setParts] = useState<PartRow[]>(
    existingParts && existingParts.length > 0
      ? existingParts.map((p) => ({
          id: p.id,
          name: p.name,
          printerId: p.printerId,
          filamentId: p.filamentId,
          weightGrams: String(p.weightGrams),
          printTimeHours: String(p.printTimeHours),
          quantityPerUnit: String(p.quantityPerUnit),
        }))
      : [emptyPartRow()],
  )

  function updatePartRow(index: number, patch: Partial<PartRow>) {
    setParts((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function removePartRow(index: number) {
    setParts((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))
  }

  async function action(formData: FormData) {
    if (isComposite) {
      const validParts = parts.filter((p) => p.name && p.printerId && p.filamentId && p.weightGrams && p.printTimeHours && p.quantityPerUnit)
      if (validParts.length === 0) {
        alert('Adicione ao menos uma peça completa (nome, impressora, filamento, peso, tempo e quantidade).')
        return
      }
      formData.set(
        'partsJson',
        JSON.stringify(
          validParts.map((p) => ({
            id: p.id,
            name: p.name,
            printerId: p.printerId,
            filamentId: p.filamentId,
            weightGrams: parseFloat(p.weightGrams),
            printTimeHours: parseFloat(p.printTimeHours),
            quantityPerUnit: parseInt(p.quantityPerUnit, 10),
          })),
        ),
      )
      const zeroPriceParts = validParts.filter((p) => (filaments.find((f) => f.id === p.filamentId)?.pricePerGram ?? 0) <= 0)
      if (zeroPriceParts.length > 0) {
        const proceed = window.confirm(
          `A peça "${zeroPriceParts[0].name}" usa um filamento sem preço cadastrado. O custo do produto ficará incorreto.\n\nDeseja continuar mesmo assim?`,
        )
        if (!proceed) return
      }
    } else {
      const filament = filaments.find((f) => f.id === filamentId)
      if (filament && filament.pricePerGram <= 0) {
        const proceed = window.confirm(
          'O filamento selecionado não tem preço cadastrado. O custo do produto ficará incorreto.\n\nDeseja continuar mesmo assim?',
        )
        if (!proceed) return
      }
    }

    const result = product ? await updateProduct(product.id, formData) : await createProduct(formData)
    if (result.success) {
      if (product) router.refresh()
      else {
        formRef.current?.reset()
        setParts([emptyPartRow()])
      }
    } else {
      alert(result.error)
    }
  }

  const selectedPrinter = printers.find((p) => p.id === printerId)
  const selectedFilament = filaments.find((f) => f.id === filamentId)
  const selectedPackaging = packagingItems.find((p) => p.id === packagingItemId)

  const weight = parseFloat(weightGrams) || 0
  const printHours = parseFloat(printTimeHours) || 0
  const laborHours = parseFloat(laborTimeHours) || 0

  const filamentPricePerGram = selectedFilament?.pricePerGram ?? 0
  const printerCostPerHour = selectedPrinter?.costPerHour ?? 0
  const packagingCost = selectedPackaging?.unitCost ?? 0
  const laborCost = laborHours * laborCostPerHour

  // 2.1: pra composto, filamento/impressão são a SOMA de cada peça × sua
  // quantidade por unidade -- mão de obra/embalagem/insumos/acessórios
  // continuam nível-produto (entram na montagem, não em cada peça).
  const partsWithCost = parts.map((row) => {
    const partPrinter = printers.find((p) => p.id === row.printerId)
    const partFilament = filaments.find((f) => f.id === row.filamentId)
    const partWeight = parseFloat(row.weightGrams) || 0
    const partTime = parseFloat(row.printTimeHours) || 0
    const partQty = parseFloat(row.quantityPerUnit) || 0
    const filamentCost = partWeight * (partFilament?.pricePerGram ?? 0) * partQty
    const printCost = partTime * (partPrinter?.costPerHour ?? 0) * partQty
    return { filamentCost, printCost }
  })
  const compositeFilamentCost = partsWithCost.reduce((sum, p) => sum + p.filamentCost, 0)
  const compositePrintCost = partsWithCost.reduce((sum, p) => sum + p.printCost, 0)

  const filamentCost = isComposite ? compositeFilamentCost : weight * filamentPricePerGram
  const printCost = isComposite ? compositePrintCost : printHours * printerCostPerHour
  const totalCost = filamentCost + printCost + laborCost + packagingCost + currentSuppliesCost + currentAccessoriesCost
  const suggestedPrice = totalCost * 2
  const marketplacePrice = totalCost * 3.3

  return (
    <>
      <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-3">
        {/* Campos obrigatórios, sempre visíveis */}
        <label className="text-sm">
          Nome *
          <input name="name" defaultValue={product?.name} className="tk-input-full" required />
        </label>
        <label className="text-sm">
          Categoria *
          <input name="category" defaultValue={product?.category ?? ''} placeholder="Selecione a categoria" className="tk-input-full" required />
        </label>

        <label className="col-span-full flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            name="isComposite"
            value="true"
            checked={isComposite}
            onChange={(e) => setIsComposite(e.target.checked)}
            className="rounded border"
          />
          Este produto é composto por múltiplas partes
        </label>

        {!isComposite && (
          <>
            <label className="text-sm">
              Impressora *
              <select name="printerId" value={printerId} onChange={(e) => setPrinterId(e.target.value)} className="tk-input-full" required>
                <option value="" disabled>Selecione</option>
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Filamento *
              <select name="filamentId" value={filamentId} onChange={(e) => setFilamentId(e.target.value)} className="tk-input-full" required>
                <option value="" disabled>Selecione</option>
                {filaments.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              {selectedFilament && selectedFilament.pricePerGram <= 0 && (
                <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ Este filamento não tem preço cadastrado — o custo ficará incorreto.
                </span>
              )}
            </label>
            <label className="text-sm">
              Peso (g) *
              <input name="weightGrams" type="number" step="0.01" value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} className="tk-input-full" required />
            </label>
            <label className="text-sm">
              Tempo de impressão (h) *
              <input name="printTimeHours" type="number" step="0.001" value={printTimeHours} onChange={(e) => setPrintTimeHours(e.target.value)} className="tk-input-full" required />
            </label>
          </>
        )}

        {isComposite && (
          <div className="col-span-full space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Peças do produto</h3>
            {parts.map((row, i) => {
              const rowFilament = filaments.find((f) => f.id === row.filamentId)
              return (
                <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50 md:grid-cols-6">
                  <label className="text-xs md:col-span-2">
                    Nome da peça *
                    <input
                      value={row.name}
                      onChange={(e) => updatePartRow(i, { name: e.target.value })}
                      placeholder="Ex.: Corpo"
                      className="tk-input-full"
                      required
                    />
                  </label>
                  <label className="text-xs">
                    Impressora *
                    <select value={row.printerId} onChange={(e) => updatePartRow(i, { printerId: e.target.value })} className="tk-input-full" required>
                      <option value="" disabled>Selecione</option>
                      {printers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    Filamento *
                    <select value={row.filamentId} onChange={(e) => updatePartRow(i, { filamentId: e.target.value })} className="tk-input-full" required>
                      <option value="" disabled>Selecione</option>
                      {filaments.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    {rowFilament && rowFilament.pricePerGram <= 0 && (
                      <span className="mt-1 block text-amber-600 dark:text-amber-400">⚠️ sem preço</span>
                    )}
                  </label>
                  <label className="text-xs">
                    Peso (g) *
                    <input type="number" step="0.01" value={row.weightGrams} onChange={(e) => updatePartRow(i, { weightGrams: e.target.value })} className="tk-input-full" required />
                  </label>
                  <label className="text-xs">
                    Tempo impr. (h) *
                    <input type="number" step="0.001" value={row.printTimeHours} onChange={(e) => updatePartRow(i, { printTimeHours: e.target.value })} className="tk-input-full" required />
                  </label>
                  <label className="text-xs">
                    Qtd. por unidade *
                    <input type="number" step="1" min="1" value={row.quantityPerUnit} onChange={(e) => updatePartRow(i, { quantityPerUnit: e.target.value })} className="tk-input-full" required />
                  </label>
                  {parts.length > 1 && (
                    <button type="button" onClick={() => removePartRow(i)} className="tk-link-danger col-span-full text-left text-xs">
                      Remover peça
                    </button>
                  )}
                </div>
              )
            })}
            <button type="button" onClick={() => setParts((rows) => [...rows, emptyPartRow()])} className="text-xs font-medium text-amber-600 hover:underline dark:text-amber-400">
              + Adicionar peça
            </button>
          </div>
        )}

        {/* Campos opcionais, colapsáveis */}
        <details className="col-span-full">
          <summary className="tk-summary">Campos opcionais</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            <label className="text-sm">
              Tempo de mão de obra (h) (opcional)
              <input name="laborTimeHours" type="number" step="0.001" value={laborTimeHours} onChange={(e) => setLaborTimeHours(e.target.value)} className="tk-input-full" />
            </label>
            <label className="text-sm">
              Embalagem (opcional)
              <select name="packagingItemId" value={packagingItemId} onChange={(e) => setPackagingItemId(e.target.value)} className="tk-input-full">
                <option value="">Nenhuma</option>
                {packagingItems.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Acabamento (opcional)
              <select name="finishingType" defaultValue={product?.finishingType ?? 'NENHUM'} className="tk-input-full">
                {FINISHING_TYPES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input name="usesGlue" type="checkbox" value="true" defaultChecked={product?.usesGlue} className="rounded border" />
              Usa cola (opcional)
            </label>
            <label className="col-span-full text-sm md:col-span-3">
              Observações (opcional)
              <textarea name="notes" defaultValue={product?.notes ?? ''} className="tk-input-full" rows={2} />
            </label>
          </div>
        </details>

        <div className="col-span-full mt-2">
          <SubmitButton pendingLabel="Salvando…">{product ? 'Salvar alterações' : 'Adicionar'}</SubmitButton>
        </div>
      </form>

      {showLiveCostPanel && (
      <div className="mt-4 tk-panel p-4">
        <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Custo estimado (ao vivo)</h2>
        <dl className="space-y-1 text-sm">
          {isComposite ? (
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <dt>Filamento + impressão ({parts.length} peça{parts.length === 1 ? '' : 's'})</dt>
              <dd>{money(filamentCost + printCost)}</dd>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <dt>Filamento ({weight}g × {money(filamentPricePerGram)}/g)</dt>
                <dd>{money(filamentCost)}</dd>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <dt>Impressão ({printHours}h × {money(printerCostPerHour)}/h)</dt>
                <dd>{money(printCost)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <dt>Mão de obra ({laborHours}h × {money(laborCostPerHour)}/h)</dt>
            <dd>{money(laborCost)}</dd>
          </div>
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <dt>Embalagem{selectedPackaging ? ` (${selectedPackaging.name})` : ''}</dt>
            <dd>{money(packagingCost)}</dd>
          </div>
          {currentSuppliesCost > 0 && (
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <dt>Insumos</dt>
              <dd>{money(currentSuppliesCost)}</dd>
            </div>
          )}
          {currentAccessoriesCost > 0 && (
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <dt>Acessórios</dt>
              <dd>{money(currentAccessoriesCost)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1 font-medium text-slate-900 dark:border-slate-800 dark:text-slate-100">
            <dt>Custo total</dt>
            <dd>{money(totalCost)}</dd>
          </div>
          <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-400">
            <dt>Preço sugerido (× 2)</dt>
            <dd>{money(suggestedPrice)}</dd>
          </div>
          <div className="flex justify-between font-semibold text-amber-700 dark:text-amber-400">
            <dt>Preço marketplace (× 3,3)</dt>
            <dd>{money(marketplacePrice)}</dd>
          </div>
        </dl>
      </div>
      )}
    </>
  )
}
