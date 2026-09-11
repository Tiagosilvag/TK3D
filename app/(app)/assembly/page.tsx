import { prisma } from '@/lib/prisma'
import { getAssemblyStatus, getAssemblyOverview } from '@/actions/assembly'
import { AssemblyOverview } from './AssemblyOverview'
import { AssemblyDetailModal } from './AssemblyDetailModal'

export const dynamic = 'force-dynamic'

export default async function AssemblyPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>
}) {
  const { productId } = await searchParams

  const [overview, status, allAccessories, allSupplies, allPackaging] = await Promise.all([
    getAssemblyOverview(),
    productId ? getAssemblyStatus(productId) : Promise.resolve(null),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Montagem</h1>

      <AssemblyOverview rows={overview} />

      {overview.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto com peça, insumo ou acessório cadastrado ainda.
        </div>
      )}

      <AssemblyDetailModal
        status={status}
        allAccessories={allAccessories.map((a) => ({ id: a.id, name: a.name, colorName: a.colorName, available: Math.max(0, a.currentStock.toNumber()) }))}
        allSupplies={allSupplies.map((s) => ({ id: s.id, name: s.name, unit: s.unit, available: Math.max(0, s.currentStock.toNumber()), catalogDefaultUsage: s.defaultUsage?.toNumber() ?? null }))}
        allPackaging={allPackaging.map((p) => ({ id: p.id, name: p.name, available: Math.max(0, p.currentStock.toNumber()) }))}
      />
    </div>
  )
}
