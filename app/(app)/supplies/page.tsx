import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { SupplyForm } from './SupplyForm'
import { deleteSupply, reactivateSupply } from '@/actions/supplies'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

const SUPPLY_UNIT_LABELS: Record<string, string> = {
  UN: 'Unidade',
  ML: 'Mililitro',
  G: 'Grama',
}

export default async function SuppliesPage() {
  const [items, inactiveItems] = await Promise.all([
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.supply.findMany({ where: { active: false }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Insumos</h1>
      <SupplyForm />
      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Nome</th>
            <th>Unidade</th>
            <th>Custo unitário</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="tk-row">
              <td className="py-2">{item.name}</td>
              <td>{SUPPLY_UNIT_LABELS[item.unit] ?? item.unit}</td>
              <td>{formatCurrency(item.unitCost.toNumber())}</td>
              <td>
                <ConfirmDeleteForm action={async () => { 'use server'; await deleteSupply(item.id) }} />
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
                <th>Unidade</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inactiveItems.map((item) => (
                <tr key={item.id} className="tk-row-inactive">
                  <td className="py-2">{item.name}</td>
                  <td>{SUPPLY_UNIT_LABELS[item.unit] ?? item.unit}</td>
                  <td>
                    <form action={async () => { 'use server'; await reactivateSupply(item.id) }}>
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
