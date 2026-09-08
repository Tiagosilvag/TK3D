import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { ProductionRunForm } from './ProductionRunForm'
import { CancelProductionRunForm } from './CancelProductionRunForm'
import { deleteProductionRun } from '@/actions/productionRuns'
import type { ProductionCostSnapshot } from '@/lib/costing'
import { formatCurrency, getProductionStatusBadge } from '@/lib/format'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { resolveDateRange } from '@/lib/dateRange'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string; from?: string; to?: string; page?: string; productId?: string; printerId?: string }>
}) {
  const { editId, from, to, page, productId, printerId } = await searchParams
  const range = resolveDateRange({ from, to })
  const currentPage = Math.max(1, parseInt(page ?? '1', 10) || 1)

  const runsWhere = {
    date: { gte: range.gte, lte: range.lte },
    ...(productId ? { productId } : {}),
    ...(printerId ? { printerId } : {}),
  }

  const [runs, totalRuns, products, printers, filaments, editingRunRecord] = await Promise.all([
    prisma.productionRun.findMany({
      where: runsWhere,
      orderBy: { date: 'desc' },
      include: { product: true, printer: true, filament: true },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.productionRun.count({ where: runsWhere }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { currentStockGrams: { gt: 0 } }, orderBy: { manufacturer: 'asc' } }),
    editId
      ? prisma.productionRun.findUnique({ where: { id: editId }, include: { product: true, printer: true, filament: true } })
      : null,
  ])

  const totalPages = Math.max(1, Math.ceil(totalRuns / PAGE_SIZE))

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams()
    qs.set('from', range.from)
    qs.set('to', range.to)
    if (productId) qs.set('productId', productId)
    if (printerId) qs.set('printerId', printerId)
    qs.set('page', String(targetPage))
    return `/production?${qs.toString()}`
  }

  function filterHref(params: { productId?: string; printerId?: string }): string {
    const qs = new URLSearchParams()
    qs.set('from', range.from)
    qs.set('to', range.to)
    const nextProductId = 'productId' in params ? params.productId : productId
    const nextPrinterId = 'printerId' in params ? params.printerId : printerId
    if (nextProductId) qs.set('productId', nextProductId)
    if (nextPrinterId) qs.set('printerId', nextPrinterId)
    return `/production?${qs.toString()}`
  }

  const editingRun = editingRunRecord
    ? {
        id: editingRunRecord.id,
        productName: editingRunRecord.product.name,
        printerName: editingRunRecord.printer.name,
        filamentName: `${editingRunRecord.filament.manufacturer} ${editingRunRecord.filament.colorName} — Rolo #${String(editingRunRecord.filament.rollNumber).padStart(3, '0')}`,
        date: editingRunRecord.date.toISOString().slice(0, 10),
        quantityPlanned: editingRunRecord.quantityPlanned,
        quantitySuccess: editingRunRecord.quantitySuccess,
        quantityFailed: editingRunRecord.quantityFailed,
        gramsUsed: editingRunRecord.gramsUsed.toNumber(),
        gramsWasted: editingRunRecord.gramsWasted.toNumber(),
        timeWastedHours: editingRunRecord.timeWastedHours.toNumber(),
        wasteReason: editingRunRecord.wasteReason,
        notes: editingRunRecord.notes,
      }
    : undefined

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Produção e desperdício</h1>
      <DateRangeFilter action="/production" from={range.from} to={range.to} hiddenParams={{ productId, printerId }} />

      <form method="get" action="/production" className="mb-4 flex flex-wrap items-end gap-3 tk-panel p-3">
        <input type="hidden" name="from" value={range.from} />
        <input type="hidden" name="to" value={range.to} />
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Produto
          <select name="productId" defaultValue={productId ?? ''} className="tk-input-full mt-1">
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Impressora
          <select name="printerId" defaultValue={printerId ?? ''} className="tk-input-full mt-1">
            <option value="">Todas</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white dark:bg-amber-500 dark:text-slate-950">
          Filtrar
        </button>
        {(productId || printerId) && (
          <Link href={filterHref({ productId: undefined, printerId: undefined })} className="text-sm font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400">
            Limpar
          </Link>
        )}
      </form>
      <ProductionRunForm
        key={editingRun?.id ?? 'new'}
        products={products}
        printers={printers}
        filaments={filaments.map((f) => ({ id: f.id, name: `${f.manufacturer} ${f.colorName} (${f.material}) — Rolo #${String(f.rollNumber).padStart(3, '0')} (${f.currentStockGrams.toNumber()}g restantes)` }))}
        editingRun={editingRun}
      />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Data</th>
            <th>Produto</th>
            <th>Impressora</th>
            <th>Filamento</th>
            <th>Plan.</th>
            <th>Sucesso</th>
            <th>Falhas</th>
            <th>Status</th>
            <th>Desperdício</th>
            <th>Custo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const badge = getProductionStatusBadge(run.status)
            // costSnapshot is only null for legacy rows created before Task 7
            // added the column (see prisma/schema.prisma's costSnapshot doc
            // comment) -- there's no historical Printer/Filament/Settings
            // state to reconstruct one for them, so this never recalculates
            // live (spec §4): it shows "—" instead.
            const snapshot = run.costSnapshot as unknown as ProductionCostSnapshot | null

            return (
              <tr key={run.id} className="tk-row">
                <td className="py-2">{run.date.toLocaleDateString('pt-BR')}</td>
                <td>{run.product.name}</td>
                <td>{run.printer.name}</td>
                <td>{run.filament.manufacturer} {run.filament.colorName} — Rolo #{String(run.filament.rollNumber).padStart(3, '0')}</td>
                <td>{run.quantityPlanned}</td>
                <td>{run.quantitySuccess}</td>
                <td>{run.quantityFailed}</td>
                <td>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    title={run.status === 'CANCELADA' && run.cancelReason ? `Motivo: ${run.cancelReason}` : undefined}
                  >
                    {badge.label}
                  </span>
                </td>
                <td>{run.gramsWasted.toNumber()}g / {run.timeWastedHours.toNumber()}h</td>
                <td>{snapshot ? formatCurrency(snapshot.total) : '—'}</td>
                <td className="flex flex-col items-start gap-1 py-2">
                  {run.status !== 'CANCELADA' && (
                    <Link href={`/production?editId=${run.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Editar
                    </Link>
                  )}
                  {run.status !== 'CANCELADA' && <CancelProductionRunForm id={run.id} />}
                  <ConfirmDeleteForm action={async () => { 'use server'; await deleteProductionRun(run.id) }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {runs.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma produção encontrada com esses filtros.
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Página {currentPage} de {totalPages} ({totalRuns} registros)</span>
          <div className="flex gap-2">
            {currentPage > 1 && (
              <Link href={pageHref(currentPage - 1)} className="rounded-lg px-3 py-1.5 font-medium text-amber-600 hover:underline dark:text-amber-400">
                Anterior
              </Link>
            )}
            {currentPage < totalPages && (
              <Link href={pageHref(currentPage + 1)} className="rounded-lg px-3 py-1.5 font-medium text-amber-600 hover:underline dark:text-amber-400">
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
