import { prisma } from '@/lib/prisma'
import { SupplyForm } from './SupplyForm'
import { deleteSupply } from '@/actions/supplies'

export const dynamic = 'force-dynamic'

const SUPPLY_UNIT_LABELS: Record<string, string> = {
  UN: 'Unidade',
  ML: 'Mililitro',
  G: 'Grama',
}

export default async function SuppliesPage() {
  const items = await prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } })

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Insumos</h1>
      <SupplyForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Nome</th>
            <th>Unidade</th>
            <th>Custo unitário</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="py-2">{item.name}</td>
              <td>{SUPPLY_UNIT_LABELS[item.unit] ?? item.unit}</td>
              <td>R$ {item.unitCost.toNumber().toFixed(4)}</td>
              <td>
                <form action={async () => { 'use server'; await deleteSupply(item.id) }}>
                  <button className="text-red-600 hover:underline">Remover</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
