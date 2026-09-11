'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency, getProductionStatusBadge } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'
import { ActionsMenu } from '@/components/ActionsMenu'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { CancelProductionRunForm } from './CancelProductionRunForm'
import { deleteProductionRun, getPlateDetail, type ProductionByProductRow, type PlateListRow, type PlateDetail } from '@/actions/productionRuns'
import { ProductionRunBatchForm } from './ProductionRunBatchForm'
import type { ProductionStatus } from '@prisma/client'

type Option = { id: string; name: string }
type FilamentOption = { id: string; name: string; pricePerGram: number }

// Melhoria "Produção" (reformulação Plate): a lista principal volta a ser
// uma linha por PEÇA/run, não mais agrupada por batchId -- desde que cada
// peça ganhou sua própria data (ver ProductionRunBatchForm), um batchId
// pode cobrir várias datas diferentes, o que quebra a premissa de "1 evento
// = 1 data" que a tabela agrupada antiga dependia. `plateId` (quando
// presente) é a Plate real que imprimiu esta peça junto de outras -- link
// pra abrir o detalhe dela.
export interface ProductionRunRow {
  id: string
  date: string
  productName: string
  partName: string | null
  plateId: string | null
  quantitySuccess: number
  quantityFailed: number
  status: ProductionStatus
  cost: number | null
  cancelReason: string | null
}

export function ProductionRunsExplorer({
  runs,
  byProduct,
  plates,
  products,
  printers,
  filaments,
}: {
  runs: ProductionRunRow[]
  byProduct: ProductionByProductRow[]
  plates: PlateListRow[]
  products: Option[]
  printers: Option[]
  filaments: FilamentOption[]
}) {
  const router = useRouter()
  const plateDialogRef = useRef<HTMLDialogElement>(null)
  const [newRunOpen, setNewRunOpen] = useState(false)
  const [tab, setTab] = useState<'lista' | 'produto' | 'plates'>('lista')
  const [plateDetail, setPlateDetail] = useState<PlateDetail | null>(null)

  async function handleRemoveItem(id: string) {
    const result = await deleteProductionRun(id)
    if (result.success) router.refresh()
    return result
  }

  async function openPlateDetail(plateId: string) {
    const detail = await getPlateDetail(plateId)
    if (!detail) return
    setPlateDetail(detail)
    plateDialogRef.current?.showModal()
  }

  const TABS: { key: typeof tab; label: string }[] = [
    { key: 'lista', label: 'Lista' },
    { key: 'produto', label: 'Por produto' },
    { key: 'plates', label: 'Plates' },
  ]

  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 font-medium ${tab === t.key ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setNewRunOpen(true)} className="tk-btn-primary px-4">
          + Registrar produção
        </button>
      </div>

      {tab === 'lista' && (
        runs.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
            Nenhuma produção encontrada com esses filtros.
          </div>
        ) : (
          <table className="tk-table-zebra mt-4 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Data</th>
                <th>Produto</th>
                <th>Peça</th>
                <th>Plate</th>
                <th>Sucesso/Falhas</th>
                <th>Custo</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const badge = getProductionStatusBadge(run.status)
                return (
                  <tr key={run.id} className="tk-row">
                    <td className="py-2">{new Date(run.date).toLocaleDateString('pt-BR')}</td>
                    <td className="font-medium text-slate-900 dark:text-slate-100">{run.productName}</td>
                    <td className="text-slate-500 dark:text-slate-400">{run.partName ?? '—'}</td>
                    <td>
                      {run.plateId ? (
                        <button type="button" onClick={() => void openPlateDetail(run.plateId!)} className="text-amber-600 hover:underline dark:text-amber-400">
                          Ver Plate
                        </button>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td>
                      <span className="text-emerald-600 dark:text-emerald-400">{run.quantitySuccess}</span> / <span className={run.quantityFailed > 0 ? 'text-red-600 dark:text-red-400' : ''}>{run.quantityFailed}</span>
                    </td>
                    <td>{run.cost != null ? formatCurrency(run.cost) : '—'}</td>
                    <td><StatusBadge badge={badge} title={run.status === 'CANCELADA' && run.cancelReason ? `Motivo: ${run.cancelReason}` : undefined} /></td>
                    <td className="py-2">
                      <ActionsMenu>
                        {run.status !== 'CANCELADA' && (
                          <Link href={`/production?editId=${run.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                            Editar
                          </Link>
                        )}
                        {run.status !== 'CANCELADA' && <CancelProductionRunForm id={run.id} />}
                        <ConfirmDeleteForm action={() => handleRemoveItem(run.id)} />
                      </ActionsMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      )}

      {tab === 'produto' && (
        byProduct.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
            Nenhuma produção registrada ainda.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {byProduct.map((row) => (
              <div key={row.productId} className="tk-panel p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">{row.productName}</h3>
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{row.completeSets} conjunto(s) completo(s)</span>
                </div>
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400">
                      <th className="py-1 font-medium">Peça</th>
                      <th className="py-1 font-medium">Produzido (sucesso)</th>
                      <th className="py-1 font-medium">Produções</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.parts.map((part) => (
                      <tr key={part.partId ?? '__simple__'}>
                        <td className="py-1">{part.partName}</td>
                        <td className="py-1 tabular-nums">{part.produced}</td>
                        <td className="py-1 tabular-nums">{part.runsCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'plates' && (
        plates.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
            Nenhuma Plate registrada ainda.
          </div>
        ) : (
          <table className="tk-table-zebra mt-4 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Data</th>
                <th>Impressora</th>
                <th>Produtos</th>
                <th>Peças</th>
                <th>Peso total</th>
                <th>Custo total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {plates.map((plate) => {
                const badge = getProductionStatusBadge(plate.status)
                return (
                  <tr key={plate.id} onClick={() => void openPlateDetail(plate.id)} className="tk-row cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="py-2">{new Date(plate.date).toLocaleDateString('pt-BR')}</td>
                    <td>{plate.printerName}</td>
                    <td className="text-slate-500 dark:text-slate-400">{plate.productNames.join(', ')}</td>
                    <td className="tabular-nums">{plate.itemCount}</td>
                    <td className="tabular-nums">{plate.totalGramsUsed.toFixed(1)}g</td>
                    <td>{formatCurrency(plate.totalCost)}</td>
                    <td><StatusBadge badge={badge} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      )}

      <ProductionRunBatchForm open={newRunOpen} onOpenChange={setNewRunOpen} products={products} printers={printers} filaments={filaments} />

      <dialog
        ref={plateDialogRef}
        onClose={() => setPlateDetail(null)}
        className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        {plateDetail && (
          <div className="grid gap-3 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold">Plate — {plateDetail.printerName}</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(plateDetail.date).toLocaleDateString('pt-BR')}</p>
                {plateDetail.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{plateDetail.notes}</p>}
              </div>
              <button type="button" onClick={() => plateDialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="tk-table-head-row">
                  <th className="py-1">Produto/Peça</th>
                  <th>Filamento</th>
                  <th>Sucesso/Falhas</th>
                  <th>Custo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plateDetail.runs.map((run) => (
                  <tr key={run.id} className="tk-row">
                    <td className="py-1">
                      {run.productName}
                      {run.partName && <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{run.partName}</span>}
                    </td>
                    <td className="text-xs text-slate-500 dark:text-slate-400">{run.filamentName}</td>
                    <td>
                      <span className="text-emerald-600 dark:text-emerald-400">{run.quantitySuccess}</span> / <span className={run.quantityFailed > 0 ? 'text-red-600 dark:text-red-400' : ''}>{run.quantityFailed}</span>
                    </td>
                    <td>{run.cost != null ? formatCurrency(run.cost) : '—'}</td>
                    <td>
                      <Link href={`/production?editId=${run.id}`} className="text-amber-600 hover:underline dark:text-amber-400">Editar</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-1 flex justify-end">
              <button type="button" onClick={() => plateDialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Fechar</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
