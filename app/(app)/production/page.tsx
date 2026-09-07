import { prisma } from '@/lib/prisma'
import { ProductionRunForm } from './ProductionRunForm'
import { deleteProductionRun } from '@/actions/productionRuns'
import { calculateWasteCost } from '@/lib/costing'

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
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Produção e desperdício</h1>
      <ProductionRunForm
        products={products}
        printers={printers}
        filaments={filaments.map((f) => ({ id: f.id, name: f.manufacturer }))}
      />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
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
            const printerDepreciationCostPerHour =
              (run.printer.purchasePrice.toNumber() + run.printer.maintenanceCost.toNumber()) /
              run.printer.depreciationHours.toNumber()
            const filamentPricePerKg = run.filament.spoolPrice.toNumber() / run.filament.spoolWeightKg.toNumber()
            const wasteCost = calculateWasteCost({
              gramsWasted: run.gramsWasted.toNumber(),
              timeWastedHours: run.timeWastedHours.toNumber(),
              filamentPricePerKg,
              printerDepreciationCostPerHour,
              printerAvgPowerConsumptionKwh: run.printer.avgPowerConsumptionKwh.toNumber(),
              energyCostPerKwh,
            })

            return (
              <tr key={run.id} className="border-b">
                <td className="py-2">{run.date.toLocaleDateString('pt-BR')}</td>
                <td>{run.product.name}</td>
                <td>{run.printer.name}</td>
                <td>{run.filament.manufacturer}</td>
                <td>{run.quantityPlanned}</td>
                <td>{run.quantitySuccess}</td>
                <td>{run.quantityFailed}</td>
                <td>{run.gramsWasted.toNumber()}g / {run.timeWastedHours.toNumber()}h</td>
                <td>R$ {wasteCost.toFixed(2)}</td>
                <td>
                  <form action={async () => { 'use server'; await deleteProductionRun(run.id) }}>
                    <button className="text-red-600 hover:underline">Remover</button>
                  </form>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
