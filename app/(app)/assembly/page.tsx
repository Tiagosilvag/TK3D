import { prisma } from '@/lib/prisma'
import { getAssemblyStatus, getAssemblyOverview } from '@/actions/assembly'
import { getOrderDemandQueue } from '@/actions/orders'
import { deserializeColorChoices } from '@/lib/reports'
import { AssemblyOverview } from './AssemblyOverview'
import { AssemblyDetailModal } from './AssemblyDetailModal'
import { AssemblyDemandPanel } from './AssemblyDemandPanel'

export const dynamic = 'force-dynamic'

export default async function AssemblyPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; presetColorComboKey?: string }>
}) {
  const { productId, presetColorComboKey } = await searchParams
  const presetColorChoices = presetColorComboKey ? deserializeColorChoices(presetColorComboKey) : null

  const [overview, status, allAccessories, allSupplies, allPackaging, demandQueue] = await Promise.all([
    getAssemblyOverview(),
    productId ? getAssemblyStatus(productId) : Promise.resolve(null),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.packagingItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    getOrderDemandQueue(),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Montagem</h1>

      <AssemblyDemandPanel rows={demandQueue.assemblyRows} />

      <AssemblyOverview rows={overview} />

      {overview.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto com peça, insumo ou acessório cadastrado ainda.
        </div>
      )}

      <AssemblyDetailModal
        status={status}
        presetColorChoices={presetColorChoices}
        allAccessories={allAccessories.map((a) => ({ id: a.id, name: a.name, colorName: a.colorName, available: Math.max(0, a.currentStock.toNumber()) }))}
        allSupplies={allSupplies.map((s) => ({ id: s.id, name: s.name, unit: s.unit, available: Math.max(0, s.currentStock.toNumber()), catalogDefaultUsage: s.defaultUsage?.toNumber() ?? null }))}
        allPackaging={allPackaging.map((p) => ({ id: p.id, name: p.name, available: Math.max(0, p.currentStock.toNumber()) }))}
      />
    </div>
  )
}
