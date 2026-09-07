import { prisma } from '@/lib/prisma'
import { calculateFilamentPricePerKg } from '@/lib/costing'
import { FilamentForm } from './FilamentForm'
import { deleteFilament } from '@/actions/filaments'

export default async function FilamentsPage() {
  const filaments = await prisma.filament.findMany({ where: { active: true }, orderBy: { manufacturer: 'asc' } })

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Filamentos</h1>
      <FilamentForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Fabricante</th>
            <th>Preço/kg</th>
            <th>Peso do rolo (kg)</th>
            <th>Diâmetro (mm)</th>
            <th>Temp. bico/mesa</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filaments.map((f) => {
            const pricePerKg = calculateFilamentPricePerKg({
              spoolPrice: f.spoolPrice.toNumber(),
              spoolWeightKg: f.spoolWeightKg.toNumber(),
            })
            return (
              <tr key={f.id} className="border-b">
                <td className="py-2">{f.manufacturer}</td>
                <td>R$ {pricePerKg.toFixed(2)}</td>
                <td>{f.spoolWeightKg.toNumber()}</td>
                <td>{f.diameterMm.toNumber()}</td>
                <td>{f.nozzleTempC}°C / {f.bedTempC}°C</td>
                <td>
                  <form action={async () => { 'use server'; await deleteFilament(f.id) }}>
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
