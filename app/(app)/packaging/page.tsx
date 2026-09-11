import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { calculateStockReferenceQuantity, calculateStockPercentRemaining } from '@/lib/costing'
import { reactivatePackagingItem } from '@/actions/packaging'
import { PackagingExplorer, type PackagingRow } from './PackagingExplorer'

export const dynamic = 'force-dynamic'

export default async function PackagingPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams

  const [items, inactiveItems, editingItemRecord] = await Promise.all([
    prisma.packagingItem.findMany({
      where: { active: true },
      include: { purchases: { orderBy: { purchaseDate: 'desc' } } },
      orderBy: { name: 'asc' },
    }),
    prisma.packagingItem.findMany({ where: { active: false }, orderBy: { name: 'asc' } }),
    editId ? prisma.packagingItem.findUnique({ where: { id: editId } }) : null,
  ])

  const editingItem = editingItemRecord
    ? { id: editingItemRecord.id, name: editingItemRecord.name, minStock: editingItemRecord.minStock.toNumber() }
    : undefined

  // Melhoria "Histórico de consumo": embalagem nunca tinha consumo
  // registrado em lugar nenhum (bug -- currentStock só subia); agora é
  // consumida na venda (actions/sales.ts#consumePackagingForSale), com uma
  // linha em StockConsumption por venda. Mesmo agrupamento em memória de
  // Acessórios/Insumos (page.tsx daquelas telas).
  const consumptions = await prisma.stockConsumption.findMany({
    where: { resourceType: 'PACKAGING', resourceId: { in: items.map((i) => i.id) } },
    include: { product: { select: { name: true } } },
    orderBy: { consumedAt: 'desc' },
  })
  const consumptionsByItem = new Map<string, typeof consumptions>()
  for (const c of consumptions) {
    const list = consumptionsByItem.get(c.resourceId) ?? []
    list.push(c)
    consumptionsByItem.set(c.resourceId, list)
  }

  // Mesmo raciocínio de Acessórios/Insumos (lib/costing.ts#calculateStockReferenceQuantity):
  // % restante é sobre a média das últimas compras, não o total histórico.
  const rows: PackagingRow[] = items.map((item) => {
    const currentStock = item.currentStock.toNumber()
    const referenceQuantity = calculateStockReferenceQuantity(item.purchases.map((p) => p.quantity.toNumber()))
    return {
      id: item.id,
      name: item.name,
      currentStock,
      avgUnitCost: item.avgUnitCost.toNumber(),
      minStock: item.minStock.toNumber(),
      percentRemaining: calculateStockPercentRemaining(currentStock, referenceQuantity),
      purchases: item.purchases.map((p) => ({
        id: p.id,
        purchaseDate: p.purchaseDate.toISOString(),
        quantity: p.quantity.toNumber(),
        totalCost: p.totalCost.toNumber(),
      })),
      consumptionHistory: (consumptionsByItem.get(item.id) ?? []).map((c) => ({
        id: c.id,
        consumedAt: c.consumedAt.toISOString(),
        quantity: c.quantity.toNumber(),
        productName: c.product.name,
        source: c.source,
      })),
    }
  })

  return (
    <div className="tk-page">
      <PackagingExplorer rows={rows} editingItem={editingItem} />

      {inactiveItems.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Mostrar inativos ({inactiveItems.length})</summary>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Nome</th>
                <th>Custo unitário</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inactiveItems.map((item) => (
                <tr key={item.id} className="tk-row-inactive">
                  <td className="py-2">{item.name}</td>
                  <td>{formatCurrency(item.avgUnitCost.toNumber())}</td>
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
