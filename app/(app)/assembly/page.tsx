import { prisma } from '@/lib/prisma'
import { getAssemblyStatus, getAssemblyOverview, getRecentAssemblies } from '@/actions/assembly'
import { getOrderDemandQueue } from '@/actions/orders'
import { deserializeColorChoices } from '@/lib/reports'
import { AssemblyOverview } from './AssemblyOverview'
import { AssemblyDetailModal } from './AssemblyDetailModal'
import { AssemblyQueuePanel } from './AssemblyQueuePanel'
import { RecentAssemblies } from './RecentAssemblies'

export const dynamic = 'force-dynamic'

export default async function AssemblyPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; presetColorComboKey?: string; qty?: string }>
}) {
  const { productId, presetColorComboKey, qty } = await searchParams
  const desiredQuantity = qty && Number.isInteger(Number(qty)) && Number(qty) > 0 ? Number(qty) : null
  const presetColorChoices = presetColorComboKey ? deserializeColorChoices(presetColorComboKey) : null

  const [overview, status, allAccessories, allSupplies, demandQueue, recent] = await Promise.all([
    getAssemblyOverview(),
    productId ? getAssemblyStatus(productId) : Promise.resolve(null),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getOrderDemandQueue(),
    getRecentAssemblies(8),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Montagem</h1>

      <AssemblyQueuePanel items={demandQueue.assemblyQueue} />

      <AssemblyOverview rows={overview} />

      <RecentAssemblies rows={recent} />

      {overview.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto com peça, insumo ou acessório cadastrado ainda.
        </div>
      )}

      <AssemblyDetailModal
        status={status}
        presetColorChoices={presetColorChoices}
        desiredQuantity={desiredQuantity}
        allAccessories={allAccessories.map((a) => ({ id: a.id, name: a.name, colorName: a.colorName, available: Math.max(0, a.currentStock.toNumber()) }))}
        allSupplies={allSupplies.map((s) => ({ id: s.id, name: s.name, unit: s.unit, available: Math.max(0, s.currentStock.toNumber()), catalogDefaultUsage: s.defaultUsage?.toNumber() ?? null }))}
      />
    </div>
  )
}
