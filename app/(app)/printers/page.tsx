import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { calculatePrinterDepreciationCostPerHour, calculatePrinterMaintenanceCostPerHour } from '@/lib/costing'
import { formatCurrency } from '@/lib/format'
import { PrinterForm } from './PrinterForm'
import { deletePrinter, reactivatePrinter, deletePrinterPermanently } from '@/actions/printers'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function PrintersPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams

  const [printers, inactivePrinters, settings, editingPrinterRecord] = await Promise.all([
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: false }, orderBy: { name: 'asc' } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    editId ? prisma.printer.findUnique({ where: { id: editId } }) : null,
  ])

  const annualMaintenancePercent = settings.annualMaintenancePercent.toNumber()
  const annualUsageHours = settings.annualUsageHours.toNumber()
  const energyCostPerKwh = settings.energyCostPerKwh.toNumber()

  const editingPrinter = editingPrinterRecord
    ? {
        id: editingPrinterRecord.id,
        name: editingPrinterRecord.name,
        purchasePrice: editingPrinterRecord.purchasePrice.toNumber(),
        depreciationHours: editingPrinterRecord.depreciationHours.toNumber(),
        avgPowerConsumptionKwh: editingPrinterRecord.avgPowerConsumptionKwh.toNumber(),
      }
    : undefined

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Impressoras</h1>
      <PrinterForm
        key={editingPrinter?.id ?? 'new'}
        settings={{ annualMaintenancePercent, annualUsageHours, energyCostPerKwh }}
        editingPrinter={editingPrinter}
      />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Nome</th>
            <th>Preço</th>
            <th>Vida útil (h)</th>
            <th>Depreciação R$/h</th>
            <th>Consumo kWh/h</th>
            <th>Energia R$/h</th>
            <th>Manutenção R$/h</th>
            <th>Custo total R$/h</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {printers.map((p) => {
            const purchasePrice = p.purchasePrice.toNumber()
            const depreciationHours = p.depreciationHours.toNumber()
            const avgPowerConsumptionKwh = p.avgPowerConsumptionKwh.toNumber()

            const depCost = calculatePrinterDepreciationCostPerHour({ purchasePrice, depreciationHours })
            const maintCost = calculatePrinterMaintenanceCostPerHour({ purchasePrice, annualMaintenancePercent, annualUsageHours })
            const electricityCost = avgPowerConsumptionKwh * energyCostPerKwh
            const totalCost = depCost + maintCost + electricityCost

            return (
              <tr key={p.id} className="tk-row">
                <td className="py-2">{p.name}</td>
                <td>{formatCurrency(purchasePrice)}</td>
                <td>{depreciationHours}</td>
                <td>{formatCurrency(depCost)}</td>
                <td>{avgPowerConsumptionKwh}</td>
                <td>{formatCurrency(electricityCost)}</td>
                <td>{formatCurrency(maintCost)}</td>
                <td>{formatCurrency(totalCost)}</td>
                <td>
                  <div className="flex items-center gap-3">
                    <Link href={`/printers?editId=${p.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Editar
                    </Link>
                    <ConfirmDeleteForm
                      action={async () => { 'use server'; await deletePrinter(p.id) }}
                      label="Desativar"
                    />
                    <ConfirmDeleteForm
                      action={async () => { 'use server'; await deletePrinterPermanently(p.id) }}
                      label="Excluir permanentemente"
                      confirmMessage="Excluir esta impressora permanentemente? Essa ação não pode ser desfeita."
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {inactivePrinters.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Mostrar inativos ({inactivePrinters.length})</summary>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Nome</th>
                <th>Preço</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inactivePrinters.map((p) => (
                <tr key={p.id} className="tk-row-inactive">
                  <td className="py-2">{p.name}</td>
                  <td>{formatCurrency(p.purchasePrice.toNumber())}</td>
                  <td>
                    <div className="flex items-center gap-3">
                      <form action={async () => { 'use server'; await reactivatePrinter(p.id) }}>
                        <button className="tk-link-success">Reativar</button>
                      </form>
                      <ConfirmDeleteForm
                        action={async () => { 'use server'; await deletePrinterPermanently(p.id) }}
                        label="Excluir permanentemente"
                        confirmMessage="Excluir esta impressora permanentemente? Essa ação não pode ser desfeita."
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
