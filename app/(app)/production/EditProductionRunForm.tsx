'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { updateProductionRun, updateProductionRunPrinter } from '@/actions/productionRuns'
import { WASTE_REASON_LABELS } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import { HoursInput } from '@/components/HoursInput'
import type { WasteReason } from '@prisma/client'

const WASTE_REASON_OPTIONS = Object.keys(WASTE_REASON_LABELS) as WasteReason[]

export interface EditingRun {
  id: string
  productName: string
  productPartName: string | null
  printerId: string
  printerName: string
  // Melhoria "Editar impressora depois de criar": calculado no server
  // (page.tsx) -- falso quando a produção faz parte de uma Plate (impressora
  // compartilhada por todas as peças) ou é anterior a este recurso (não
  // guardou o tempo de impressão congelado, não dá pra recalcular com
  // precisão).
  canEditPrinter: boolean
  // Motivo exibido quando !canEditPrinter -- null quando canEditPrinter é
  // true (nada a explicar).
  printerLockedReason: string | null
  filamentName: string
  // Ajuste "peça multi-filamento": updateProductionRun recusa editar
  // desperdício de uma produção com várias cores reais (o formulário
  // simples de "gramas desperdiçadas" não sabe dizer qual cor mudou) --
  // ver esse motivo exibido em vez dos campos de edição.
  isMultiFilament: boolean
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

// Extraído do antigo ProductionRunForm.tsx (cadastro virou o modal
// ProductionRunBatchForm) -- correção pós-fato de uma produção já
// registrada continua exatamente como era: quantidade/filamento somente
// leitura, só desperdício/observações editáveis, acessada via `?editId=`.
export function EditProductionRunForm({ editingRun, printers }: { editingRun: EditingRun; printers: { id: string; name: string }[] }) {
  const router = useRouter()
  const [timeWastedHours, setTimeWastedHours] = useState(String(editingRun.timeWastedHours))
  const [printerId, setPrinterId] = useState(editingRun.printerId)

  async function action(formData: FormData) {
    const result = await updateProductionRun(editingRun.id, formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.push('/production')
  }

  // Melhoria "Editar impressora depois de criar": correção independente do
  // form principal (desperdício/observações) -- são dois ajustes
  // conceitualmente separados, cada um com seu próprio resultado de
  // sucesso/erro, sem acoplar as duas validações num só submit.
  async function changePrinterAction() {
    const result = await updateProductionRunPrinter(editingRun.id, printerId)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.push('/production')
  }

  return (
    <form action={action} className="mb-4 grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-4">
      <p className="col-span-full text-sm text-slate-500 dark:text-slate-400">
        Produção concluída — quantidade e qual filamento ficam somente leitura para preservar o histórico. Consumo (gramas usadas/desperdiçadas), tempo e observações podem ser corrigidos; o estoque de filamento é ajustado automaticamente pela diferença.
      </p>
      <div className="text-sm">
        <span className="block text-slate-500 dark:text-slate-400">Produto</span>
        <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.productName}</span>
      </div>
      {editingRun.productPartName && (
        <div className="text-sm">
          <span className="block text-slate-500 dark:text-slate-400">Peça</span>
          <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.productPartName}</span>
        </div>
      )}
      <div className="text-sm">
        <span className="block text-slate-500 dark:text-slate-400">Impressora</span>
        {editingRun.canEditPrinter ? (
          <div className="mt-1 flex items-center gap-1.5">
            <select value={printerId} onChange={(e) => setPrinterId(e.target.value)} className="tk-input-full">
              {printers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {printerId !== editingRun.printerId && (
              <button type="button" onClick={() => void changePrinterAction()} className="shrink-0 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-violet-500">
                Trocar
              </button>
            )}
          </div>
        ) : (
          <>
            <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.printerName}</span>
            {editingRun.printerLockedReason && (
              <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">{editingRun.printerLockedReason}</span>
            )}
          </>
        )}
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

      {editingRun.isMultiFilament ? (
        <>
          <div className="text-sm">
            <span className="block text-slate-500 dark:text-slate-400">Filamento usado (g)</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">{editingRun.gramsUsed}g</span>
          </div>
          <p className="col-span-full text-sm text-amber-600 dark:text-amber-400">
            Esta produção usou mais de um filamento -- não é possível corrigir consumo/desperdício aqui, porque não dá pra saber qual cor mudou.
            Cancele esta produção e registre de novo com os valores corretos.
          </p>
        </>
      ) : (
        <>
          {/* Melhoria "Produção" (reformulação Plate) §42: consumo real
              (gramas) passa a ser editável também -- mesmo aviso de
              recálculo automático já dado pro desperdício abaixo. Editar
              este campo NUNCA muda unitCost/total do costSnapshot (que são
              derivados do peso da ficha técnica, não do consumo real) -- só
              o estoque de filamento decrementado e o consumo registrado. */}
          <label className="text-sm">
            Filamento usado (g)
            <input name="gramsUsed" type="number" step="0.01" min="0" defaultValue={editingRun.gramsUsed} className="tk-input-full" />
          </label>
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
        </>
      )}

      <div className="col-span-full mt-2 flex items-center gap-3">
        {!editingRun.isMultiFilament && <SubmitButton pendingLabel="Salvando…">Salvar alterações</SubmitButton>}
        <Link href="/production" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
          {editingRun.isMultiFilament ? 'Voltar' : 'Cancelar'}
        </Link>
      </div>
    </form>
  )
}
