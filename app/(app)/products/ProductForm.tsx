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

function money(value: number): string {
  return formatCurrency(value)
}

export function ProductForm({
  product,
  printers,
  filaments,
  packagingItems,
  laborCostPerHour,
  currentSuppliesCost = 0,
  currentAccessoriesCost = 0,
  showLiveCostPanel = true,
}: {
  product?: ProductValues
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
  const [printerId, setPrinterId] = useState(product?.printerId ?? '')
  const [filamentId, setFilamentId] = useState(product?.filamentId ?? '')
  const [weightGrams, setWeightGrams] = useState(product ? String(product.weightGrams) : '')
  const [printTimeHours, setPrintTimeHours] = useState(product ? String(product.printTimeHours) : '')
  const [laborTimeHours, setLaborTimeHours] = useState(product ? String(product.laborTimeHours) : '0')
  const [packagingItemId, setPackagingItemId] = useState(product?.packagingItemId ?? '')

  async function action(formData: FormData) {
    const filament = filaments.find((f) => f.id === filamentId)
    if (filament && filament.pricePerGram <= 0) {
      const proceed = window.confirm(
        'O filamento selecionado não tem preço cadastrado. O custo do produto ficará incorreto.\n\nDeseja continuar mesmo assim?',
      )
      if (!proceed) return
    }

    const result = product ? await updateProduct(product.id, formData) : await createProduct(formData)
    if (result.success) {
      if (product) router.refresh()
      else formRef.current?.reset()
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
  const filamentCost = weight * filamentPricePerGram
  const printCost = printHours * printerCostPerHour
  const laborCost = laborHours * laborCostPerHour
  const packagingCost = selectedPackaging?.unitCost ?? 0
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
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <dt>Filamento ({weight}g × {money(filamentPricePerGram)}/g)</dt>
            <dd>{money(filamentCost)}</dd>
          </div>
          <div className="flex justify-between text-slate-600 dark:text-slate-400">
            <dt>Impressão ({printHours}h × {money(printerCostPerHour)}/h)</dt>
            <dd>{money(printCost)}</dd>
          </div>
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
