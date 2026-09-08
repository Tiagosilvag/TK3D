import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { ProductionRunForm } from './ProductionRunForm'
import { CancelProductionRunForm } from './CancelProductionRunForm'
import { deleteProductionRun } from '@/actions/productionRuns'
import type { ProductionCostSnapshot } from '@/lib/costing'
import { formatCurrency, getProductionStatusBadge } from '@/lib/format'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams

  const [runs, products, printers, filaments, editingRunRecord] = await Promise.all([
    prisma.productionRun.findMany({
      orderBy: { date: 'desc' },
      include: { product: true, printer: true, filament: true },
    }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { currentStockGrams: { gt: 0 } }, orderBy: { manufacturer: 'asc' } }),
    editId
      ? prisma.productionRun.findUnique({ where: { id: editId }, include: { product: true, printer: true, filament: true } })
      : null,
  ])

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
    </div>
  )
}
