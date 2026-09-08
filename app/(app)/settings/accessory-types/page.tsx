import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { NewTypeForm } from './NewTypeForm'
import { RenameTypeForm } from './RenameTypeForm'
import { DeleteTypeForm } from './DeleteTypeForm'

export const dynamic = 'force-dynamic'

export default async function AccessoryTypesPage() {
  const types = await prisma.accessoryTypeRecord.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { accessories: true } } },
  })

  return (
    <div className="tk-page">
      <Link href="/settings" className="text-sm text-slate-500 hover:underline dark:text-slate-400">&larr; Configurações</Link>
      <h1 className="mb-4 mt-1 font-display text-lg font-semibold text-slate-900 dark:text-slate-100">Tipos de acessório</h1>

      <NewTypeForm />

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Nome</th>
            <th>Em uso</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id} className="tk-row">
              <td className="py-2">
                <RenameTypeForm id={t.id} name={t.name} />
              </td>
              <td>{t._count.accessories}</td>
              <td>
                {t._count.accessories === 0 ? (
                  <DeleteTypeForm id={t.id} />
                ) : (
                  <span className="text-xs text-slate-400 dark:text-slate-500" title="Tipos em uso não podem ser removidos">
                    Em uso
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {types.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum tipo de acessório cadastrado.
        </div>
      )}
    </div>
  )
}
