import { prisma } from '@/lib/prisma'
import { AccessoryForm } from './AccessoryForm'
import { deleteAccessory } from '@/actions/accessories'

const ACCESSORY_TYPE_LABELS: Record<string, string> = {
  CORRENTE_BOLINHA: 'Corrente bolinha',
  CORRENTE_ELO: 'Corrente elo',
  MOSQUETAO: 'Mosquetão',
  CLICKER: 'Clicker',
  OUTRO: 'Outro',
}

export default async function AccessoriesPage() {
  const items = await prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } })

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Acessórios</h1>
      <AccessoryForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Nome</th>
            <th>Tipo</th>
            <th>Custo unitário</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="py-2">{item.name}</td>
              <td>{ACCESSORY_TYPE_LABELS[item.type] ?? item.type}</td>
              <td>R$ {item.unitCost.toNumber().toFixed(4)}</td>
              <td>
                <form action={async () => { 'use server'; await deleteAccessory(item.id) }}>
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
