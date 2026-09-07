import { prisma } from '@/lib/prisma'
import { ProductionRunForm } from './ProductionRunForm'
import { deleteProductionRun } from '@/actions/productionRuns'
import { calculateWasteCost, calculatePrinterDepreciationCostPerHour, calculateFilamentPricePerKg } from '@/lib/costing'
import { formatCurrency } from '@/lib/format'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function ProductionPage() {
  const [runs, products, printers, filaments, settings] = await Promise.all([
    prisma.productionRun.findMany({
      orderBy: { date: 'desc' },
      include: { product: true, printer: true, filament: true },
    }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.filament.findMany({ where: { active: true }, orderBy: { manufacturer: 'asc' } }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])

  const energyCostPerKwh = settings.energyCostPerKwh.toNumber()

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Produção e desperdício</h1>
      <ProductionRunForm
        products={products}
        printers={printers}
        filaments={filaments.map((f) => ({ id: f.id, name: f.manufacturer }))}
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
            <th>Desperdício</th>
            <th>Custo desperdício</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const printerDepreciationCostPerHour = calculatePrinterDepreciationCostPerHour({
              purchasePrice: run.printer.purchasePrice.toNumber(),
              depreciationHours: run.printer.depreciationHours.toNumber(),
            })
            const filamentPricePerKg = calculateFilamentPricePerKg({
              spoolPrice: run.filament.spoolPrice.toNumber(),
              spoolWeightKg: run.filament.spoolWeightKg.toNumber(),
            })
            const wasteCost = calculateWasteCost({
              gramsWasted: run.gramsWasted.toNumber(),
              timeWastedHours: run.timeWastedHours.toNumber(),
              filamentPricePerKg,
              printerDepreciationCostPerHour,
              printerAvgPowerConsumptionKwh: run.printer.avgPowerConsumptionKwh.toNumber(),
              energyCostPerKwh,
            })

            return (
              <tr key={run.id} className="tk-row">
                <td className="py-2">{run.date.toLocaleDateString('pt-BR')}</td>
                <td>{run.product.name}</td>
                <td>{run.printer.name}</td>
                <td>{run.filament.manufacturer}</td>
                <td>{run.quantityPlanned}</td>
                <td>{run.quantitySuccess}</td>
                <td>{run.quantityFailed}</td>
                <td>{run.gramsWasted.toNumber()}g / {run.timeWastedHours.toNumber()}h</td>
                <td>{formatCurrency(wasteCost)}</td>
                <td>
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
