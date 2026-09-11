'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency, getProductionStatusBadge } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'
import { ActionsMenu } from '@/components/ActionsMenu'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { CancelProductionRunForm } from './CancelProductionRunForm'
import { deleteProductionRun } from '@/actions/productionRuns'
import { ProductionRunBatchForm } from './ProductionRunBatchForm'
import type { ProductionStatus } from '@prisma/client'

type Option = { id: string; name: string }

export interface ProductionEventItem {
  id: string
  partName: string | null
  quantitySuccess: number
  quantityFailed: number
  status: ProductionStatus
  cost: number | null
  cancelReason: string | null
}

// Melhoria "Produção" §4: uma linha da lista principal é UM EVENTO de
// produção (Data + Produto, agrupado por ProductionRun.batchId) -- pode
// cobrir 1 ou várias peças, dependendo de quantas foram marcadas juntas na
// mesma submissão do modal "Registrar produção".
export interface ProductionEventRow {
  batchId: string
  date: string
  productName: string
  items: ProductionEventItem[]
}

export function ProductionRunsExplorer({
  events,
  products,
  printers,
  filaments,
}: {
  events: ProductionEventRow[]
  products: Option[]
  printers: Option[]
  filaments: Option[]
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<ProductionEventRow | null>(null)
  const [newRunOpen, setNewRunOpen] = useState(false)

  function openDetail(event: ProductionEventRow) {
    setSelected(event)
    dialogRef.current?.showModal()
  }

  async function handleRemoveItem(id: string) {
    const result = await deleteProductionRun(id)
    if (result.success) router.refresh()
    return result
  }

  return (
    <>
      <div className="flex justify-end">
        <button type="button" onClick={() => setNewRunOpen(true)} className="tk-btn-primary px-4">
          + Registrar produção
        </button>
      </div>

      {events.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma produção encontrada com esses filtros.
        </div>
      ) : (
        <table className="tk-table-zebra mt-6 w-full text-sm">
          <thead>
            <tr className="tk-table-head-row">
              <th className="py-2">Data</th>
              <th>Produto</th>
              <th>Sucesso/Falhas</th>
              <th>Custo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const totalSuccess = event.items.reduce((sum, i) => sum + i.quantitySuccess, 0)
              const totalFailed = event.items.reduce((sum, i) => sum + i.quantityFailed, 0)
              const totalCost = event.items.reduce((sum, i) => sum + (i.cost ?? 0), 0)
              const single = event.items.length === 1

              if (single) {
                const item = event.items[0]
                const badge = getProductionStatusBadge(item.status)
                return (
                  <tr key={event.batchId} className="tk-row">
                    <td className="py-2">{new Date(event.date).toLocaleDateString('pt-BR')}</td>
                    <td className="font-medium text-slate-900 dark:text-slate-100">
                      {event.productName}
                      {item.partName && <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{item.partName}</span>}
                    </td>
                    <td>
                      <span className="text-emerald-600 dark:text-emerald-400">{item.quantitySuccess}</span> / <span className={item.quantityFailed > 0 ? 'text-red-600 dark:text-red-400' : ''}>{item.quantityFailed}</span>
                    </td>
                    <td>{item.cost != null ? formatCurrency(item.cost) : '—'}</td>
                    <td className="py-2">
                      <ActionsMenu>
                        {item.status !== 'CANCELADA' && (
                          <Link href={`/production?editId=${item.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                            Editar
                          </Link>
                        )}
                        {item.status !== 'CANCELADA' && <CancelProductionRunForm id={item.id} />}
                        <ConfirmDeleteForm action={() => handleRemoveItem(item.id)} />
                      </ActionsMenu>
                      {item.status === 'CANCELADA' && item.cancelReason && (
                        <StatusBadge badge={badge} title={`Motivo: ${item.cancelReason}`} />
                      )}
                    </td>
                  </tr>
                )
              }

              return (
                <tr key={event.batchId} onClick={() => openDetail(event)} className="tk-row cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="py-2">{new Date(event.date).toLocaleDateString('pt-BR')}</td>
                  <td className="font-medium text-slate-900 dark:text-slate-100">
                    {event.productName}
                    <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                      {event.items.length} peças ({event.items.map((i) => i.partName).join(', ')})
                    </span>
                  </td>
                  <td>
                    <span className="text-emerald-600 dark:text-emerald-400">{totalSuccess}</span> / <span className={totalFailed > 0 ? 'text-red-600 dark:text-red-400' : ''}>{totalFailed}</span>
                  </td>
                  <td>{formatCurrency(totalCost)}</td>
                  <td className="py-2 text-right text-slate-400" aria-hidden>›</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <ProductionRunBatchForm open={newRunOpen} onOpenChange={setNewRunOpen} products={products} printers={printers} filaments={filaments} />

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        {selected && (
          <div className="grid gap-3 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold">{selected.productName}</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(selected.date).toLocaleDateString('pt-BR')}</p>
              </div>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="tk-table-head-row">
                  <th className="py-1">Peça</th>
                  <th>Sucesso/Falhas</th>
                  <th>Custo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selected.items.map((item) => (
                  <tr key={item.id} className="tk-row">
                    <td className="py-1">{item.partName ?? '—'}</td>
                    <td>
                      <span className="text-emerald-600 dark:text-emerald-400">{item.quantitySuccess}</span> / <span className={item.quantityFailed > 0 ? 'text-red-600 dark:text-red-400' : ''}>{item.quantityFailed}</span>
                    </td>
                    <td>{item.cost != null ? formatCurrency(item.cost) : '—'}</td>
                    <td>
                      <ActionsMenu>
                        {item.status !== 'CANCELADA' && (
                          <Link href={`/production?editId=${item.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                            Editar
                          </Link>
                        )}
                        {item.status !== 'CANCELADA' && <CancelProductionRunForm id={item.id} />}
                        <ConfirmDeleteForm action={() => handleRemoveItem(item.id)} />
                      </ActionsMenu>
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
