'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createFilament, updateFilament } from '@/actions/filaments'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

const MATERIALS = [
  { value: 'PLA', label: 'PLA' },
  { value: 'PETG', label: 'PETG' },
  { value: 'TPU', label: 'TPU' },
  { value: 'OUTRO', label: 'Outro' },
]

function formatOrDash(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return formatCurrency(value)
}

export type EditingFilament = {
  id: string
  manufacturer: string
  material: string
  colorName: string
  colorHex: string
  spoolWeightKg: number
  spoolPrice: number
}

// Melhoria "Filamentos": formulário virou modal (<dialog> nativo, mesmo
// padrão de AdjustStockButton/DeletePrinterButton -- sem lib nova) em vez
// de ficar sempre visível no topo da tela. Controlado externamente via
// `open`/`onOpenChange` em vez de ter seu próprio botão de abertura,
// porque também precisa abrir sozinho quando a página chega com
// ?editId= (padrão `?editId=` do app, ver FilamentsExplorer/CLAUDE.md).
// `key={editingFilament?.id ?? 'new'}` no ponto de uso remonta o form (e
// reresseta os campos controlados) toda vez que alterna entre "novo" e
// "editando X", ou entre dois X diferentes.
//
// Melhoria "Repor estoque em Filamentos": cada linha de Filament já é 1
// rolo físico específico (rollNumber único por marca+material+cor, preço
// fixo daquele rolo) -- não um item fungível com custo médio como
// Acessório/Insumo/Embalagem. "Repor estoque" aqui não soma gramas numa
// linha existente: pré-preenche este MESMO formulário de criação com a
// marca/material/cor de um rolo já cadastrado (travados, não editáveis --
// é o que faz createFilament incrementar rollNumber automaticamente pra
// essa combinação) e pede só peso/preço do rolo novo, criando uma 2ª
// linha (Rolo #002, #003...) com seu próprio custo/g. Nenhuma mudança em
// createFilament/schema -- é o mesmo fluxo de "Novo filamento" de sempre,
// só com 3 campos pré-preenchidos e travados.
export function FilamentForm({
  open,
  onOpenChange,
  editingFilament,
  restockFrom,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingFilament?: EditingFilament
  restockFrom?: EditingFilament
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const source = editingFilament ?? restockFrom
  const isRestock = Boolean(restockFrom && !editingFilament)
  const [spoolWeightKg, setSpoolWeightKg] = useState(source ? String(source.spoolWeightKg) : '1')
  const [spoolPrice, setSpoolPrice] = useState(editingFilament ? String(editingFilament.spoolPrice) : '')
  const [colorHex, setColorHex] = useState(source?.colorHex ?? '#ff0000')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function action(formData: FormData) {
    const result = editingFilament
      ? await updateFilament(editingFilament.id, formData)
      : await createFilament(formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  function resetFields() {
    formRef.current?.reset()
    setSpoolWeightKg(source ? String(source.spoolWeightKg) : '1')
    setSpoolPrice(editingFilament ? String(editingFilament.spoolPrice) : '')
    setColorHex(source?.colorHex ?? '#ff0000')
  }

  const weight = parseFloat(spoolWeightKg)
  const price = parseFloat(spoolPrice)
  const hasWeightAndPrice = spoolWeightKg !== '' && spoolPrice !== '' && !isNaN(weight) && !isNaN(price) && weight > 0 && price > 0
  const pricePerKg = hasWeightAndPrice ? price / weight : NaN
  const pricePerGram = hasWeightAndPrice ? pricePerKg / 1000 : NaN
  const initialStockGrams = hasWeightAndPrice ? weight * 1000 : NaN

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetFields() }}
      className="w-full [--tk-dialog-cap:40rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 p-5">
        <div className="col-span-2 mb-1 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">
            {editingFilament ? 'Editar filamento' : isRestock ? 'Repor estoque' : 'Novo filamento'}
          </h3>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Fechar"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {isRestock && restockFrom && (
          <p className="col-span-2 -mt-1 text-sm text-slate-500 dark:text-slate-400">
            Novo rolo de <span className="font-medium text-slate-700 dark:text-slate-300">{restockFrom.manufacturer} {restockFrom.colorName}</span> ({restockFrom.material}) -- vira o próximo rolo dessa cor, com seu próprio custo.
          </p>
        )}

        {isRestock && restockFrom ? (
          <>
            <input type="hidden" name="manufacturer" value={restockFrom.manufacturer} />
            <input type="hidden" name="material" value={restockFrom.material} />
            <input type="hidden" name="colorName" value={restockFrom.colorName} />
            <input type="hidden" name="colorHex" value={restockFrom.colorHex} />
          </>
        ) : (
          <>
            <label className="text-sm">
              Marca/fabricante *
              <input name="manufacturer" placeholder="Ex: Multifila" className="tk-input-full" required defaultValue={editingFilament?.manufacturer} />
            </label>
            <label className="text-sm">
              Material
              <select name="material" defaultValue={editingFilament?.material ?? 'PLA'} className="tk-input-full" required>
                {MATERIALS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              Cor *
              <div className="mt-1 flex items-center gap-2">
                <input
                  name="colorHex"
                  type="color"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="h-9 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-700"
                />
                <input name="colorName" placeholder="Nome da cor" className="tk-input flex-1" required defaultValue={editingFilament?.colorName} />
              </div>
            </label>
          </>
        )}
        <label className="text-sm">
          Peso do rolo (kg) *
          <input
            name="spoolWeightKg"
            type="number"
            step="0.001"
            min="0.001"
            placeholder="1"
            className="tk-input-full"
            value={spoolWeightKg}
            onChange={(e) => setSpoolWeightKg(e.target.value)}
            required
          />
        </label>

        <label className="col-span-2 text-sm">
          Preço pago (R$) *
          <input
            name="spoolPrice"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0,00"
            className="tk-input-full"
            value={spoolPrice}
            onChange={(e) => setSpoolPrice(e.target.value)}
            required
          />
        </label>

        <div className="col-span-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Preview</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">R$/kg</p>
              <p className="font-medium">{formatOrDash(pricePerKg)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">R$/g</p>
              <p className="font-medium">{Number.isFinite(pricePerGram) ? `R$ ${pricePerGram.toFixed(4)}` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Estoque inicial</p>
              <p className="font-medium">{Number.isFinite(initialStockGrams) ? `${initialStockGrams}g` : '—'}</p>
            </div>
          </div>
        </div>

        <div className="col-span-2 mt-1 flex items-center justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Cancelar
          </button>
          <SubmitButton pendingLabel="Salvando…">{editingFilament ? 'Salvar alterações' : isRestock ? 'Repor estoque' : 'Adicionar'}</SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
