import { prisma } from '@/lib/prisma'
import { calculatePrinterDepreciationCostPerHour } from '@/lib/costing'
import { formatCurrency } from '@/lib/format'
import { PrinterForm } from './PrinterForm'
import { deletePrinter, reactivatePrinter } from '@/actions/printers'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function PrintersPage() {
  const [printers, inactivePrinters] = await Promise.all([
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: false }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Impressoras</h1>
      <PrinterForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Nome</th>
            <th>Preço</th>
            <th>Depreciação R$/h</th>
            <th>Consumo kWh/h</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {printers.map((p) => {
            const depCost = calculatePrinterDepreciationCostPerHour({
              purchasePrice: p.purchasePrice.toNumber(),
              maintenanceCost: p.maintenanceCost.toNumber(),
              depreciationHours: p.depreciationHours.toNumber(),
            })
            return (
              <tr key={p.id} className="tk-row">
                <td className="py-2">{p.name}</td>
                <td>{formatCurrency(p.purchasePrice.toNumber())}</td>
                <td>{formatCurrency(depCost)}</td>
                <td>{p.avgPowerConsumptionKwh.toNumber()}</td>
                <td>
                  <ConfirmDeleteForm action={async () => { 'use server'; await deletePrinter(p.id) }} />
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
                    <form action={async () => { 'use server'; await reactivatePrinter(p.id) }}>
                      <button className="tk-link-success">Reativar</button>
                    </form>
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
