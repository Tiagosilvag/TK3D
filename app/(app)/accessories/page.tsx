import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { AccessoryForm } from './AccessoryForm'
import { deleteAccessory, reactivateAccessory } from '@/actions/accessories'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

const ACCESSORY_TYPE_LABELS: Record<string, string> = {
  CORRENTE_BOLINHA: 'Corrente bolinha',
  CORRENTE_ELO: 'Corrente elo',
  MOSQUETAO: 'Mosquetão',
  CLICKER: 'Clicker',
  OUTRO: 'Outro',
}

export default async function AccessoriesPage() {
  const [items, inactiveItems] = await Promise.all([
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.accessory.findMany({ where: { active: false }, orderBy: { name: 'asc' } }),
  ])

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
              <td>{formatCurrency(item.unitCost.toNumber())}</td>
              <td>
                <ConfirmDeleteForm action={async () => { 'use server'; await deleteAccessory(item.id) }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {inactiveItems.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-slate-500">Mostrar inativos ({inactiveItems.length})</summary>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="py-2">Nome</th>
                <th>Tipo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inactiveItems.map((item) => (
                <tr key={item.id} className="border-b text-slate-400">
                  <td className="py-2">{item.name}</td>
                  <td>{ACCESSORY_TYPE_LABELS[item.type] ?? item.type}</td>
                  <td>
                    <form action={async () => { 'use server'; await reactivateAccessory(item.id) }}>
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
