'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createAccessory, createAccessoryMultiColor, updateAccessory } from '@/actions/accessories'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import { TypeSelect } from './TypeSelect'
import { TypeManagerPanel, type AccessoryTypeOption } from './TypeManagerPanel'

export type EditingAccessory = {
  id: string
  name: string
  type: string
  colorName: string
  colorHex: string | null
}

type ColorRow = { colorName: string; colorHex: string; quantity: string }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyColorRow(): ColorRow {
  return { colorName: '', colorHex: '#ff0000', quantity: '' }
}

// Melhoria "Acessórios": formulário vira modal (mesmo padrão de
// PackagingForm/SupplyForm), acionado por "Novo acessório" ou por
// ?editId=. Gestão de tipo (criar/renomear/remover) sai da tela separada
// em Configurações e passa a viver dentro deste modal, atrás de
// "Gerenciar tipos..." no dropdown de Tipo (TypeSelect.tsx) -- `view`
// alterna entre o formulário normal e o painel de gestão SEM fechar o
// modal, pra não perder o que já foi preenchido (spec §6).
export function AccessoryForm({
  open,
  onOpenChange,
  accessoryTypes,
  editingAccessory,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accessoryTypes: AccessoryTypeOption[]
  editingAccessory?: EditingAccessory
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState<'form' | 'manageTypes'>('form')
  const [type, setType] = useState(editingAccessory?.type ?? '')
  const [hasColor, setHasColor] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [totalCost, setTotalCost] = useState('')
  const [colorRows, setColorRows] = useState<ColorRow[]>([emptyColorRow()])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function resetFields() {
    formRef.current?.reset()
    setView('form')
    setType(editingAccessory?.type ?? '')
    setHasColor(false)
    setQuantity('')
    setTotalCost('')
    setColorRows([emptyColorRow()])
  }

  async function action(formData: FormData) {
    if (!type) {
      alert('Selecione um tipo')
      return
    }
    formData.set('type', type)

    if (editingAccessory) {
      const result = await updateAccessory(editingAccessory.id, formData)
      if (!result.success) {
        alert(result.error)
        return
      }
      onOpenChange(false)
      router.push('/accessories')
      return
    }

    let result
    if (hasColor) {
      formData.set('colorsJson', JSON.stringify(colorRows))
      result = await createAccessoryMultiColor(formData)
    } else {
      result = await createAccessory(formData)
    }
    if (!result.success) {
      alert(result.error)
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  function updateColorRow(index: number, patch: Partial<ColorRow>) {
    setColorRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function removeColorRow(index: number) {
    setColorRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))
  }

  const qty = parseFloat(quantity)
  const cost = parseFloat(totalCost)
  const hasBoth = quantity !== '' && totalCost !== '' && !isNaN(qty) && !isNaN(cost) && qty > 0 && cost > 0
  const unitCost = hasBoth ? cost / qty : NaN

  const colorsTotalQty = colorRows.reduce((sum, r) => sum + (parseFloat(r.quantity) || 0), 0)
  const multiColorTotalCost = parseFloat(totalCost)
  const multiColorUnitCost = colorsTotalQty > 0 && !isNaN(multiColorTotalCost) && multiColorTotalCost > 0 ? multiColorTotalCost / colorsTotalQty : NaN

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetFields() }}
      className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {view === 'manageTypes' ? (
        <div className="p-5">
          <TypeManagerPanel types={accessoryTypes} onBack={() => setView('form')} />
        </div>
      ) : (
        <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 p-5">
          <div className="col-span-2 mb-1 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">{editingAccessory ? 'Editar acessório' : 'Novo acessório'}</h3>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Fechar"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>

          <label className="col-span-2 text-sm">
            Nome *
            <input name="name" placeholder="Ex: Correntinha" className="tk-input-full" required defaultValue={editingAccessory?.name} />
          </label>

          {/* Bug: <label> envolvendo o trigger E os itens do dropdown (todos
              <button>) faz o navegador reativar implicitamente o primeiro
              controle de formulário associado (o trigger) sempre que
              QUALQUER botão dentro do label é clicado -- reabre o dropdown
              no instante seguinte a escolher um tipo. <div> não tem essa
              semântica de ativação, sem perder o texto/estilo do rótulo. */}
          <div className="col-span-2 text-sm">
            <span className="block">Tipo *</span>
            <TypeSelect types={accessoryTypes} value={type} onChange={setType} onManage={() => setView('manageTypes')} />
          </div>

          {editingAccessory ? (
            <label className="col-span-2 text-sm">
              Cor (opcional)
              <div className="mt-1 flex items-center gap-2">
                <input
                  name="colorHex"
                  type="color"
                  defaultValue={editingAccessory.colorHex ?? '#ff0000'}
                  className="h-9 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-700"
                />
                <input name="colorName" placeholder="Nome da cor" className="tk-input flex-1" defaultValue={editingAccessory.colorName} />
              </div>
            </label>
          ) : (
            <>
              {!hasColor && (
                <>
                  <label className="text-sm">
                    Quantidade (1ª compra) *
                    <input name="quantity" type="number" step="0.01" min="0.01" placeholder="Quantidade" className="tk-input-full" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                  </label>
                  <label className="text-sm">
                    Valor total pago *
                    <input name="totalCost" type="number" step="0.01" min="0.01" placeholder="0,00" className="tk-input-full" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} required />
                  </label>
                </>
              )}

              {hasColor && (
                <label className="col-span-2 text-sm">
                  Valor total pago (todas as cores) *
                  <input name="totalCost" type="number" step="0.01" min="0.01" placeholder="0,00" className="tk-input-full" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} required />
                </label>
              )}

              <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input type="checkbox" checked={hasColor} onChange={(e) => setHasColor(e.target.checked)} className="rounded border" />
                Este acessório tem uma ou mais cores
              </label>

              {!hasColor && <input type="hidden" name="colorName" value="" />}

              {hasColor && (
                <div className="col-span-2 space-y-2">
                  {colorRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="color"
                        value={row.colorHex}
                        onChange={(e) => updateColorRow(i, { colorHex: e.target.value })}
                        className="h-9 w-10 shrink-0 rounded border border-slate-300 dark:border-slate-700"
                        aria-label={`Cor da variação ${i + 1}`}
                      />
                      <input
                        placeholder="Nome da cor"
                        className="tk-input flex-1"
                        value={row.colorName}
                        onChange={(e) => updateColorRow(i, { colorName: e.target.value })}
                        required
                        aria-label={`Nome da cor da variação ${i + 1}`}
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="Qtd"
                        className="tk-input w-20"
                        value={row.quantity}
                        onChange={(e) => updateColorRow(i, { quantity: e.target.value })}
                        required
                        aria-label={`Quantidade da variação ${i + 1}`}
                      />
                      {colorRows.length > 1 && (
                        <button type="button" onClick={() => removeColorRow(i)} aria-label={`Remover variação ${i + 1}`} className="text-slate-400 hover:text-red-600 dark:hover:text-red-400">
                          🗑
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setColorRows((rows) => [...rows, emptyColorRow()])} className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60">
                    + Adicionar cor
                  </button>
                </div>
              )}

              <label className="text-sm">
                Data da compra *
                <input name="purchaseDate" type="date" defaultValue={today()} className="tk-input-full" required />
              </label>
              <label className="text-sm">
                Observações (opcional)
                <input name="notes" className="tk-input-full" />
              </label>

              <div className="col-span-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Preview</p>
                {hasColor ? (
                  <div className="space-y-1 text-sm">
                    {colorRows.map((row, i) => {
                      const rowQty = parseFloat(row.quantity)
                      return (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            <span style={{ background: row.colorHex }} className="inline-block h-2.5 w-2.5 rounded-full" />
                            {row.colorName || 'sem nome'} - {Number.isFinite(rowQty) ? rowQty : 0} un
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {Number.isFinite(multiColorUnitCost) ? `${formatCurrency(multiColorUnitCost)}/un` : '—/un'}
                          </span>
                        </div>
                      )
                    })}
                    <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-200 pt-1 font-medium dark:border-slate-700">
                      <span>Total: {colorsTotalQty} un</span>
                      <span>{Number.isFinite(multiColorTotalCost) ? formatCurrency(multiColorTotalCost) : '—'}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Custo unitário resultante: </span>
                    <span className="font-medium">{Number.isFinite(unitCost) ? formatCurrency(unitCost) : '—'}</span>
                  </p>
                )}
              </div>
            </>
          )}

          <div className="col-span-2 mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <SubmitButton pendingLabel="Salvando…">{editingAccessory ? 'Salvar alterações' : 'Cadastrar acessório'}</SubmitButton>
          </div>
        </form>
      )}
    </dialog>
  )
}
