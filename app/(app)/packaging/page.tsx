import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { PackagingForm } from './PackagingForm'
import { deletePackagingItem, reactivatePackagingItem } from '@/actions/packaging'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

export default async function PackagingPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams
  const [items, inactiveItems, editingItemRecord] = await Promise.all([
    prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.packagingItem.findMany({ where: { active: false }, orderBy: { name: 'asc' } }),
    editId ? prisma.packagingItem.findUnique({ where: { id: editId } }) : null,
  ])

  const editingItem = editingItemRecord
    ? { id: editingItemRecord.id, name: editingItemRecord.name, unitCost: editingItemRecord.unitCost.toNumber() }
    : undefined

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Embalagens</h1>
      <PackagingForm key={editingItem?.id ?? 'new'} editingItem={editingItem} />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Nome</th>
            <th>Custo unitário</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="tk-row">
              <td className="py-2">{item.name}</td>
              <td>{formatCurrency(item.unitCost.toNumber())}</td>
              <td>
                <div className="flex items-center gap-3">
                  <Link href={`/packaging?editId=${item.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                    Editar
                  </Link>
                  <ConfirmDeleteForm action={async () => { 'use server'; await deletePackagingItem(item.id) }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {inactiveItems.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Mostrar inativos ({inactiveItems.length})</summary>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Nome</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inactiveItems.map((item) => (
                <tr key={item.id} className="tk-row-inactive">
                  <td className="py-2">{item.name}</td>
                  <td>
                    <form action={async () => { 'use server'; await reactivatePackagingItem(item.id) }}>
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
