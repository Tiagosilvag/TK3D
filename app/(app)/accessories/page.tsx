import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { getStockStatusWithThresholds, calculateStockReferenceQuantity, calculateStockPercentRemaining } from '@/lib/costing'
import { AccessoriesExplorer, type AccessoryRow } from './AccessoriesExplorer'
import { RestockForm } from './RestockForm'

export const dynamic = 'force-dynamic'

export default async function AccessoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ editId?: string }>
}) {
  const { editId } = await searchParams

  const [accessories, settings, accessoryTypes, editingAccessoryRecord] = await Promise.all([
    prisma.accessory.findMany({
      include: { purchases: { orderBy: { purchaseDate: 'desc' } } },
      orderBy: [{ name: 'asc' }, { colorName: 'asc' }],
    }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    // Melhoria "Acessórios" §6: gestão de tipo agora vive dentro do modal
    // de cadastro (TypeManagerPanel) -- precisa da contagem de uso por
    // tipo aqui (não tinha antes, só a tela separada em Configurações
    // buscava isso) pra desabilitar "Remover" de um tipo em uso.
    prisma.accessoryTypeRecord.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { accessories: true } } } }),
    editId ? prisma.accessory.findUnique({ where: { id: editId } }) : null,
  ])

  // 2.6: histórico de ajustes de estoque, agrupado por acessório -- exibido
  // junto do histórico de reposições já existente (agora dentro do modal
  // de histórico, AccessoryHistoryButton.tsx).
  const adjustments = await prisma.stockAdjustment.findMany({
    where: { resourceType: 'ACCESSORY', resourceId: { in: accessories.map((a) => a.id) } },
    orderBy: { createdAt: 'desc' },
  })
  const adjustmentsByAccessory = new Map<string, typeof adjustments>()
  for (const adj of adjustments) {
    const list = adjustmentsByAccessory.get(adj.resourceId) ?? []
    list.push(adj)
    adjustmentsByAccessory.set(adj.resourceId, list)
  }

  // Melhoria "Histórico de consumo": mesma lógica de agrupamento dos
  // ajustes acima, agora pra StockConsumption (actions/stockConsumptions.ts) --
  // toda baixa de acessório feita por confirmAssembly desde essa melhoria.
  const consumptions = await prisma.stockConsumption.findMany({
    where: { resourceType: 'ACCESSORY', resourceId: { in: accessories.map((a) => a.id) } },
    include: { product: { select: { name: true } } },
    orderBy: { consumedAt: 'desc' },
  })
  const consumptionsByAccessory = new Map<string, typeof consumptions>()
  for (const c of consumptions) {
    const list = consumptionsByAccessory.get(c.resourceId) ?? []
    list.push(c)
    consumptionsByAccessory.set(c.resourceId, list)
  }

  const typeLabel = (id: string) => accessoryTypes.find((t) => t.id === id)?.name ?? id
  const editingAccessory = editingAccessoryRecord
    ? {
        id: editingAccessoryRecord.id,
        name: editingAccessoryRecord.name,
        type: editingAccessoryRecord.type,
        colorName: editingAccessoryRecord.colorName,
        colorHex: editingAccessoryRecord.colorHex,
      }
    : undefined

  const lowThresholdPercent = settings.stockLowThresholdPercent.toNumber()
  const criticalThresholdPercent = settings.stockCriticalThresholdPercent.toNumber()

  // percentRemaining (Fix 2, task-10 brief) = currentStock sobre a MÉDIA DAS
  // ÚLTIMAS N COMPRAS (lib/costing.ts#calculateStockReferenceQuantity), não
  // mais "total já comprado". Ver o comentário daquela função pro raciocínio
  // completo: dividir pelo total histórico decaía pra zero em qualquer item
  // de giro rápido (muitas reposições), classificando incorretamente um
  // item saudável como "crítico". `a.purchases` já vem ordenado por
  // purchaseDate desc (query acima), então já está na ordem que a função
  // espera (mais recente primeiro).
  const allRows = accessories.map((a) => {
    const currentStock = a.currentStock.toNumber()
    const avgUnitCost = a.avgUnitCost.toNumber()
    const referenceQuantity = calculateStockReferenceQuantity(a.purchases.map((p) => p.quantity.toNumber()))
    const percentRemaining = calculateStockPercentRemaining(currentStock, referenceQuantity)
    const valueInStock = currentStock * avgUnitCost
    const status = getStockStatusWithThresholds(percentRemaining, lowThresholdPercent, criticalThresholdPercent)
    return { accessory: a, currentStock, avgUnitCost, percentRemaining, valueInStock, status }
  })

  const mainRows = allRows.filter((r) => r.currentStock > 0)
  const esgotadosRows = allRows.filter((r) => r.currentStock <= 0)

  // Melhoria "Acessórios": busca/filtro por tipo/baixo-estoque viram
  // interativos no navegador (AccessoriesExplorer) -- rows já vem com
  // histórico (compras/ajustes/consumo) embutido por item, mesmo padrão
  // de PackagingRow/SupplyRow.
  const rows: AccessoryRow[] = mainRows.map(({ accessory: a, currentStock, avgUnitCost, valueInStock, percentRemaining, status }) => ({
    id: a.id,
    name: a.name,
    colorName: a.colorName,
    colorHex: a.colorHex,
    typeId: a.type,
    typeName: typeLabel(a.type),
    currentStock,
    avgUnitCost,
    valueInStock,
    percentRemaining,
    status,
    purchases: a.purchases.map((p) => ({
      id: p.id,
      purchaseDate: p.purchaseDate.toISOString(),
      quantity: p.quantity.toNumber(),
      totalCost: p.totalCost.toNumber(),
    })),
    adjustments: (adjustmentsByAccessory.get(a.id) ?? []).map((adj) => ({
      id: adj.id,
      createdAt: adj.createdAt.toISOString(),
      difference: adj.difference.toNumber(),
      reason: adj.reason,
      reasonNote: adj.reasonNote,
    })),
    consumptionHistory: (consumptionsByAccessory.get(a.id) ?? []).map((c) => ({
      id: c.id,
      consumedAt: c.consumedAt.toISOString(),
      quantity: c.quantity.toNumber(),
      productName: c.product.name,
      source: c.source,
    })),
  }))

  const accessoryTypeOptions = accessoryTypes.map((t) => ({ id: t.id, name: t.name, count: t._count.accessories }))

  // Cards de resumo (task-3 brief): sempre sobre o conjunto completo,
  // independente dos filtros de tipo/estoque aplicados na listagem abaixo.
  const totalValueInStock = allRows.reduce((sum, r) => sum + r.valueInStock, 0)
  const countByStatus = allRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status.label] = (acc[r.status.label] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="tk-page">
      <AccessoriesExplorer
        rows={rows}
        accessoryTypes={accessoryTypeOptions}
        editingAccessory={editingAccessory}
        summary={{ totalValueInStock, countByStatus }}
      />

      {esgotadosRows.length > 0 && (
        <details className="mt-8">
          <summary className="tk-summary">Acessórios esgotados ({esgotadosRows.length})</summary>
          {/* Fix 1 (task-10 brief): esgotados não podem ser excluídos (guarda em
              deleteAccessory) -- o botão de excluir some desta seção porque a
              ação sempre recusaria, sem oferecer uma opção que nunca funciona. */}
          <table className="tk-table-zebra mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2"></th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Cor</th>
                <th>Custo médio</th>
                <th>Repor estoque</th>
              </tr>
            </thead>
            <tbody>
              {esgotadosRows.map(({ accessory: a, avgUnitCost }) => (
                <tr key={a.id} className="tk-row-inactive">
                  <td className="py-2">
                    {a.colorHex && <span style={{ background: a.colorHex }} className="inline-block h-3 w-3 rounded-full" />}
                  </td>
                  <td>{a.name}</td>
                  <td>{typeLabel(a.type)}</td>
                  <td>{a.colorName || '—'}</td>
                  <td>{formatCurrency(avgUnitCost)}</td>
                  <td>
                    <RestockForm accessoryId={a.id} accessoryName={a.name} />
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
