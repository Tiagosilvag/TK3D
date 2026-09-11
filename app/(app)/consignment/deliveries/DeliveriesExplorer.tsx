'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import { deleteConsignmentDelivery } from '@/actions/consignmentDeliveries'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { DeliveryBatchForm, type PartnerOption, type ProductOption } from './DeliveryBatchForm'

export interface DeliveryBatchItem {
  id: string
  productName: string
  colorLabel: string | null
  colorHex: string | null
  quantityDelivered: number
  unitPrice: number
}

export interface DeliveryBatchRow {
  batchId: string
  partnerName: string
  deliveryDate: string
  items: DeliveryBatchItem[]
}

// Melhoria "Entregas em consignação" §4: lista principal vira uma linha por
// EVENTO de entrega (agrupado por batchId, ver ConsignmentDelivery.batchId
// no schema), não mais uma linha por produto -- clicar abre um modal com o
// detalhe de cada produto/cor daquela entrega específica.
export function DeliveriesExplorer({
  batches,
  partners,
  products,
  defaultProductId,
}: {
  batches: DeliveryBatchRow[]
  partners: PartnerOption[]
  products: ProductOption[]
  defaultProductId?: string
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<DeliveryBatchRow | null>(null)
  const [newDeliveryOpen, setNewDeliveryOpen] = useState(!!defaultProductId)

  function openDetail(batch: DeliveryBatchRow) {
    setSelected(batch)
    dialogRef.current?.showModal()
  }

  async function handleRemoveItem(id: string) {
    const result = await deleteConsignmentDelivery(id)
    if (result.success) router.refresh()
    return result
  }

  return (
    <>
      <div className="flex justify-end">
        <button type="button" onClick={() => setNewDeliveryOpen(true)} className="tk-btn-primary px-4">
          + Registrar entrega
        </button>
      </div>

      {batches.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma entrega encontrada com esses filtros.
        </div>
      ) : (
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="tk-table-head-row">
              <th className="py-2">Data</th>
              <th>Parceiro</th>
              <th>Produtos</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => {
              const totalUnits = batch.items.reduce((sum, i) => sum + i.quantityDelivered, 0)
              const totalValue = batch.items.reduce((sum, i) => sum + i.quantityDelivered * i.unitPrice, 0)
              return (
                <tr key={batch.batchId} onClick={() => openDetail(batch)} className="tk-row cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="py-2">{new Date(batch.deliveryDate).toLocaleDateString('pt-BR')}</td>
                  <td className="font-medium text-slate-900 dark:text-slate-100">{batch.partnerName}</td>
                  <td className="text-slate-500 dark:text-slate-400">{batch.items.length} {batch.items.length === 1 ? 'item' : 'itens'} - {totalUnits} un</td>
                  <td className="font-medium text-slate-900 dark:text-slate-100">{formatCurrency(totalValue)}</td>
                  <td className="text-right text-slate-400" aria-hidden>›</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <DeliveryBatchForm
        open={newDeliveryOpen}
        onOpenChange={setNewDeliveryOpen}
        partners={partners}
        products={products}
        defaultProductId={defaultProductId}
      />

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        {selected && (
          <div className="grid gap-3 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold">{selected.partnerName}</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(selected.deliveryDate).toLocaleDateString('pt-BR')}</p>
              </div>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="tk-table-head-row">
                  <th className="py-1">Produto</th>
                  <th>Qtd.</th>
                  <th>Preço unit.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selected.items.map((item) => (
                  <tr key={item.id} className="tk-row">
                    <td className="py-1">
                      <span className="flex items-center gap-1.5">
                        {item.colorHex && <span style={{ background: item.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                        {item.productName}{item.colorLabel && <span className="text-slate-500 dark:text-slate-400"> - {item.colorLabel}</span>}
                      </span>
                    </td>
                    <td>{item.quantityDelivered}</td>
                    <td>{formatCurrency(item.unitPrice)}</td>
                    <td>
                      <ConfirmDeleteForm action={() => handleRemoveItem(item.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-1 flex justify-end">
              <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Fechar</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
