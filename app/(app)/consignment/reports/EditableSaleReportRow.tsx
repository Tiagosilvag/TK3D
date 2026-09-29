'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import { updateConsignmentSaleReport, deleteConsignmentSaleReport } from '@/actions/consignmentSaleReports'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export interface SaleReportRowData {
  id: string
  deliveryId: string
  reportDate: string
  partnerName: string
  productName: string
  quantitySold: number
  commissionPercent: number
  unitPrice: number
  // Saldo disponível pra este relatório, já excluindo a própria quantidade
  // (senão ela contaria contra si mesma) -- teto do campo Qtd. ao editar.
  maxQuantity: number
}

// Melhoria "editar tudo no consignado": um relatório de venda já registrado
// virava só apagar-e-recriar (deleteConsignmentSaleReport existia, editar
// não). Aqui os 4 campos (data/quantidade/preço/comissão) entram no mesmo
// "Salvar" -- diferente do editor de quantidade de DeliveriesExplorer (que
// tem UM campo "dono" só), um relatório de venda não tem um campo principal
// óbvio, então vira 1 form por linha em vez de 1 mini-form por campo.
export function EditableSaleReportRow({ report }: { report: SaleReportRowData }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [quantitySold, setQuantitySold] = useState(String(report.quantitySold))
  const [commissionPercent, setCommissionPercent] = useState(String(Math.round(report.commissionPercent * 100)))
  const [unitPrice, setUnitPrice] = useState(String(report.unitPrice))
  const [reportDate, setReportDate] = useState(report.reportDate.slice(0, 10))
  const [error, setError] = useState<string | null>(null)

  const gross = report.quantitySold * report.unitPrice
  const payout = gross * (1 - report.commissionPercent)

  function cancelEdit() {
    setQuantitySold(String(report.quantitySold))
    setCommissionPercent(String(Math.round(report.commissionPercent * 100)))
    setUnitPrice(String(report.unitPrice))
    setReportDate(report.reportDate.slice(0, 10))
    setError(null)
    setEditing(false)
  }

  async function handleSave() {
    const fd = new FormData()
    fd.set('deliveryId', report.deliveryId)
    fd.set('quantitySold', quantitySold)
    fd.set('commissionPercent', String((parseFloat(commissionPercent) || 0) / 100))
    fd.set('unitPrice', unitPrice)
    fd.set('reportDate', reportDate)
    const result = await updateConsignmentSaleReport(report.id, fd)
    if (!result.success) {
      setError(result.error ?? 'Erro ao salvar')
      return
    }
    setEditing(false)
    router.refresh()
  }

  async function handleDelete() {
    const result = await deleteConsignmentSaleReport(report.id)
    if (result.success) router.refresh()
    return result
  }

  if (!editing) {
    return (
      <tr className="tk-row">
        <td className="py-2">{new Date(report.reportDate).toLocaleDateString('pt-BR')}</td>
        <td>{report.partnerName}</td>
        <td>{report.productName}</td>
        <td className="text-center">{report.quantitySold}</td>
        <td className="text-center">{formatCurrency(report.unitPrice)}</td>
        <td className="text-center">{(report.commissionPercent * 100).toFixed(0)}%</td>
        <td className="text-center">{formatCurrency(payout)}</td>
        <td>
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
              Editar
            </button>
            <ConfirmDeleteForm action={handleDelete} label="Remover" className="text-xs font-medium text-red-600 hover:underline dark:text-red-400" />
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="tk-row align-top">
      <td className="py-2">
        <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="tk-input w-32" />
      </td>
      <td>{report.partnerName}</td>
      <td>{report.productName}</td>
      <td className="text-center">
        <input
          type="number"
          step="1"
          min={1}
          max={report.maxQuantity}
          value={quantitySold}
          onChange={(e) => setQuantitySold(e.target.value)}
          className="tk-input w-16 text-right"
        />
      </td>
      <td className="text-center">
        <input type="number" step="0.01" min={0.01} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="tk-input w-20 text-right" />
      </td>
      <td className="text-center">
        <div className="flex items-center justify-center gap-1">
          <input
            type="number"
            step="1"
            min={0}
            max={100}
            value={commissionPercent}
            onChange={(e) => setCommissionPercent(e.target.value)}
            className="tk-input w-14 text-right"
          />
          <span className="text-xs text-slate-400 dark:text-slate-500">%</span>
        </div>
      </td>
      <td className="text-center text-slate-400 dark:text-slate-500">—</td>
      <td>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={handleSave} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
            Salvar
          </button>
          <button type="button" onClick={cancelEdit} className="text-xs text-slate-400 hover:underline dark:text-slate-500">
            Cancelar
          </button>
        </div>
        {error && <p className="mt-1 max-w-[180px] text-xs text-red-600 dark:text-red-400">{error}</p>}
      </td>
    </tr>
  )
}
