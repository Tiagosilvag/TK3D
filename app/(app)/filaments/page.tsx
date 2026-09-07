import { prisma } from '@/lib/prisma'
import { calculateFilamentPricePerKg } from '@/lib/costing'
import { formatCurrency } from '@/lib/format'
import { FilamentForm } from './FilamentForm'
import { deleteFilament, reactivateFilament } from '@/actions/filaments'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function FilamentsPage() {
  const [filaments, inactiveFilaments] = await Promise.all([
    prisma.filament.findMany({ where: { active: true }, orderBy: { manufacturer: 'asc' } }),
    prisma.filament.findMany({ where: { active: false }, orderBy: { manufacturer: 'asc' } }),
  ])

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
                <td>{formatCurrency(pricePerKg)}</td>
                <td>{f.spoolWeightKg.toNumber()}</td>
                <td>{f.diameterMm.toNumber()}</td>
                <td>{f.nozzleTempC}°C / {f.bedTempC}°C</td>
                <td>
                  <ConfirmDeleteForm action={async () => { 'use server'; await deleteFilament(f.id) }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {inactiveFilaments.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-slate-500">Mostrar inativos ({inactiveFilaments.length})</summary>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-2">Fabricante</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inactiveFilaments.map((f) => (
                <tr key={f.id} className="border-b text-slate-400">
                  <td className="py-2">{f.manufacturer}</td>
                  <td>
                    <form action={async () => { 'use server'; await reactivateFilament(f.id) }}>
                      <button className="text-emerald-600 hover:underline">Reativar</button>
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
