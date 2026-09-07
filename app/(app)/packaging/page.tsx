import { prisma } from '@/lib/prisma'
import { PackagingForm } from './PackagingForm'
import { deletePackagingItem } from '@/actions/packaging'

export default async function PackagingPage() {
  const items = await prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } })

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Embalagens</h1>
      <PackagingForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">Nome</th>
            <th>Custo unitário</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="py-2">{item.name}</td>
              <td>R$ {item.unitCost.toNumber().toFixed(4)}</td>
              <td>
                <form action={async () => { 'use server'; await deletePackagingItem(item.id) }}>
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
