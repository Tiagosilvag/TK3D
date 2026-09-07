import { prisma } from '@/lib/prisma'
import { calculatePrinterDepreciationCostPerHour } from '@/lib/costing'
import { PrinterForm } from './PrinterForm'
import { deletePrinter } from '@/actions/printers'

export const dynamic = 'force-dynamic'

export default async function PrintersPage() {
  const printers = await prisma.printer.findMany({ where: { active: true }, orderBy: { name: 'asc' } })

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Impressoras</h1>
      <PrinterForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
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
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.name}</td>
                <td>R$ {p.purchasePrice.toNumber().toFixed(2)}</td>
                <td>R$ {depCost.toFixed(4)}</td>
                <td>{p.avgPowerConsumptionKwh.toNumber()}</td>
                <td>
                  <form action={async () => { 'use server'; await deletePrinter(p.id) }}>
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
