'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createConsignmentSaleReportBatch } from '@/actions/consignmentSaleReports'
import type { ConsignmentSaleableDelivery } from '@/lib/reports'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { SubmitButton } from '@/components/SubmitButton'

interface SaleRow {
  deliveryId: string
  productName: string
  colorLabel: string | null
  remaining: number
  defaultUnitPrice: number
  checked: boolean
  quantitySold: string
  unitPrice: string
}

function buildRows(deliveries: ConsignmentSaleableDelivery[]): SaleRow[] {
  return deliveries.map((d) => ({
    deliveryId: d.deliveryId,
    productName: d.productName,
    colorLabel: d.colorLabel,
    remaining: d.remaining,
    defaultUnitPrice: d.unitPrice,
    checked: false,
    quantitySold: '',
    unitPrice: String(d.unitPrice),
  }))
}

// Bug "não tem opção de registrar venda do produto consignado" + pedido
// "quero poder selecionar TODOS os produtos entregues e disponíveis pra
// lançar a venda de uma vez": a 1ª volta deste modal só deixava escolher
// UMA entrega por submissão (<select> único); agora vira uma lista com
// checkbox por entrega (mesmo padrão de "Registrar produção" -- marcar
// várias peças e registrar tudo numa submissão só), com "Marcar todas"
// pra já vender o saldo inteiro de cada produto disponível de uma vez.
// Data do relatório e observações são únicas pro lote inteiro; cada linha
// mantém sua própria entrega/quantidade/preço (createConsignmentSaleReportBatch
// em actions/consignmentSaleReports.ts cria 1 ConsignmentSaleReport por
// linha marcada, tudo numa transação só).
//
// Bug "modal com rolagem horizontal / texto sem quebrar": cada linha era um
// <label> flex sem min-w-0 -- um flex item sem min-w-0 nunca encolhe abaixo
// da largura do próprio conteúdo (default min-width:auto), então o
// `truncate` do <span> interno nunca tinha chance de agir; o conteúdo
// estourava a linha e isso força a modal (dialog com overflow-y:auto, que
// vira overflow-x:auto automaticamente por regra do CSS quando o conteúdo
// transborda) a ganhar rolagem horizontal. Fix: cada linha agora empilha
// verticalmente (nome quebra em vez de truncar -- nomes de combo de cor
// podem ser longos -- e os campos de quantidade/preço vão numa segunda
// linha), nada de flex horizontal apertado.
//
// Pedido "opção de por o valor por unidade": às vezes o parceiro vendeu por
// um preço diferente do cadastrado na entrega -- cada linha pré-preenche
// com ConsignmentSaleableDelivery.unitPrice (o valor da entrega) mas
// permite sobrescrever só para aquela venda (ConsignmentSaleReport.unitPrice,
// nulo quando igual ao da entrega -- ver comentário no schema). Pedido
// "adicionar um valor pra todas em massa": `applyBulkPrice` sobrescreve o
// campo de TODAS as linhas de uma vez, evitando editar campo por campo
// quando o parceiro vendeu tudo pelo mesmo valor combinado.
export function RegisterSaleForm({
  deliveries,
  defaultCommissionPercent,
}: {
  deliveries: ConsignmentSaleableDelivery[]
  defaultCommissionPercent: number
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<SaleRow[]>(() => buildRows(deliveries))
  const [reportDate, setReportDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [bulkPrice, setBulkPrice] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function resetFields() {
    formRef.current?.reset()
    setRows(buildRows(deliveries))
    setReportDate(today())
    setNotes('')
  }

  function updateRow(deliveryId: string, patch: Partial<SaleRow>) {
    setRows((prev) => prev.map((r) => (r.deliveryId === deliveryId ? { ...r, ...patch } : r)))
  }

  function markAll() {
    setRows((prev) => prev.map((r) => ({ ...r, checked: true, quantitySold: String(r.remaining) })))
  }

  function unmarkAll() {
    setRows((prev) => prev.map((r) => ({ ...r, checked: false })))
  }

  // Pedido "opção de adicionar um valor para todas as unidades em massa":
  // sobrescreve o preço unitário de TODAS as linhas de uma vez (marcadas ou
  // não -- só reflete na venda de fato pras que ficarem marcadas na hora de
  // enviar), em vez de precisar editar campo por campo quando o parceiro
  // vendeu tudo pelo mesmo valor combinado.
  function applyBulkPrice() {
    const price = bulkPrice.trim()
    if (!price) return
    setRows((prev) => prev.map((r) => ({ ...r, unitPrice: price })))
  }

  async function action() {
    const checkedRows = rows.filter((r) => r.checked)
    if (checkedRows.length === 0) {
      alert('Marque ao menos um produto')
      return
    }
    for (const row of checkedRows) {
      const qty = parseInt(row.quantitySold, 10) || 0
      if (qty <= 0 || qty > row.remaining) {
        alert(`Quantidade inválida para "${row.productName}${row.colorLabel ? ` — ${row.colorLabel}` : ''}" (saldo: ${row.remaining})`)
        return
      }
      const price = parseFloat(row.unitPrice)
      if (!Number.isFinite(price) || price <= 0) {
        alert(`Preço inválido para "${row.productName}${row.colorLabel ? ` — ${row.colorLabel}` : ''}"`)
        return
      }
    }

    const fd = new FormData()
    fd.set('reportDate', reportDate)
    fd.set('notes', notes || '')
    fd.set(
      'itemsJson',
      JSON.stringify(
        checkedRows.map((r) => {
          const price = parseFloat(r.unitPrice)
          return {
            deliveryId: r.deliveryId,
            quantitySold: parseInt(r.quantitySold, 10),
            commissionPercent: defaultCommissionPercent,
            unitPrice: price !== r.defaultUnitPrice ? price : null,
          }
        }),
      ),
    )
    const result = await createConsignmentSaleReportBatch(fd)
    if (!result.success) {
      alert(result.error)
      return
    }
    setOpen(false)
    resetFields()
    router.refresh()
  }

  if (deliveries.length === 0) return null

  const checkedCount = rows.filter((r) => r.checked).length

  return (
    <>
      <button
        type="button"
        onClick={() => { setRows(buildRows(deliveries)); setOpen(true) }}
        className="tk-btn-primary px-3 py-1.5 text-sm"
      >
        + Registrar venda
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => { setOpen(false); resetFields() }}
        className="w-full [--tk-dialog-cap:40rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form ref={formRef} action={action} className="grid grid-cols-1 gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Registrar venda</h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Produtos disponíveis</p>
            <div className="flex gap-3 text-xs font-medium">
              <button type="button" onClick={markAll} className="text-violet-600 hover:underline dark:text-violet-400">
                Marcar todas
              </button>
              <button type="button" onClick={unmarkAll} className="text-violet-600 hover:underline dark:text-violet-400">
                Desmarcar todas
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
            <label className="flex-1 text-xs text-slate-500 dark:text-slate-400">
              Aplicar preço unit. (R$) a todas
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={bulkPrice}
                onChange={(e) => setBulkPrice(e.target.value)}
                placeholder="Ex: 17,14"
                className="tk-input-full"
              />
            </label>
            <button type="button" onClick={applyBulkPrice} className="mt-4 shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
              Aplicar
            </button>
          </div>

          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.deliveryId} className={`rounded-lg border p-2 ${row.checked ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 dark:border-slate-800'}`}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.checked}
                    onChange={(e) => updateRow(row.deliveryId, {
                      checked: e.target.checked,
                      quantitySold: e.target.checked && !row.quantitySold ? String(row.remaining) : row.quantitySold,
                    })}
                    className="mt-0.5 shrink-0 rounded border"
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {row.productName}{row.colorLabel ? ` — ${row.colorLabel}` : ''}
                    <span className="ml-1 text-xs font-normal text-slate-400 dark:text-slate-500">(saldo: {row.remaining})</span>
                  </span>
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    Quantidade
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max={row.remaining}
                      value={row.quantitySold}
                      onChange={(e) => updateRow(row.deliveryId, { quantitySold: e.target.value, checked: true })}
                      disabled={!row.checked}
                      className="tk-input-full"
                    />
                  </label>
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    Preço unit. (R$)
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={row.unitPrice}
                      onChange={(e) => updateRow(row.deliveryId, { unitPrice: e.target.value, checked: true })}
                      disabled={!row.checked}
                      className="tk-input-full"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <label className="text-sm">
            Data do relatório
            <input name="reportDate" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="tk-input-full" required />
          </label>

          <label className="text-sm">
            Observações (opcional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="tk-input-full" rows={1} />
          </label>

          <div className="mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
            <SubmitButton pendingLabel="Registrando…" disabled={checkedCount === 0}>
              Registrar venda{checkedCount > 0 ? ` (${checkedCount})` : ''}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
