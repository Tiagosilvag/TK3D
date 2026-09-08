import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency, getStockStatusBadge, STOCK_ADJUSTMENT_REASON_LABELS } from '@/lib/format'
import { getStockStatusWithThresholds, calculateStockReferenceQuantity, calculateStockPercentRemaining } from '@/lib/costing'
import { AccessoryForm } from './AccessoryForm'
import { RestockForm } from './RestockForm'
import { deleteAccessory } from '@/actions/accessories'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { StatusBadge } from '@/components/StatusBadge'
import { ActionsMenu } from '@/components/ActionsMenu'

export const dynamic = 'force-dynamic'

function buildHref(params: { type?: string; stock?: string }): string {
  const qs = new URLSearchParams()
  if (params.type) qs.set('type', params.type)
  if (params.stock) qs.set('stock', params.stock)
  const s = qs.toString()
  return s ? `/accessories?${s}` : '/accessories'
}

function tabClass(isActive: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR')
}

export default async function AccessoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; stock?: string; editId?: string }>
}) {
  const { type, stock, editId } = await searchParams
  const activeStock = stock === 'baixo' ? 'baixo' : undefined

  const [accessories, settings, accessoryTypes, editingAccessoryRecord] = await Promise.all([
    prisma.accessory.findMany({
      include: { purchases: { orderBy: { purchaseDate: 'desc' } } },
      orderBy: [{ name: 'asc' }, { colorName: 'asc' }],
    }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
    prisma.accessoryTypeRecord.findMany({ orderBy: { name: 'asc' } }),
    editId ? prisma.accessory.findUnique({ where: { id: editId } }) : null,
  ])

  // 2.6: histórico de ajustes de estoque, agrupado por acessório -- exibido
  // junto do histórico de reposições já existente na mesma <details>.
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

  const activeType = accessoryTypes.some((t) => t.id === type) ? type : undefined
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
  const rows = accessories.map((a) => {
    const currentStock = a.currentStock.toNumber()
    const avgUnitCost = a.avgUnitCost.toNumber()
    const referenceQuantity = calculateStockReferenceQuantity(a.purchases.map((p) => p.quantity.toNumber()))
    const percentRemaining = calculateStockPercentRemaining(currentStock, referenceQuantity)
    const valueInStock = currentStock * avgUnitCost
    const status = getStockStatusWithThresholds(percentRemaining, lowThresholdPercent, criticalThresholdPercent)
    return { accessory: a, currentStock, avgUnitCost, percentRemaining, valueInStock, status }
  })

  const mainRows = rows.filter((r) => r.currentStock > 0)
  const esgotadosRows = rows.filter((r) => r.currentStock <= 0)

  const filteredMainRows = mainRows
    .filter((r) => (activeType ? r.accessory.type === activeType : true))
    .filter((r) => (activeStock === 'baixo' ? r.percentRemaining > 0 && r.percentRemaining <= lowThresholdPercent * 100 : true))

  // Cards de resumo (task-3 brief): sempre sobre o conjunto completo,
  // independente dos filtros de tipo/estoque aplicados na listagem abaixo.
  const totalValueInStock = rows.reduce((sum, r) => sum + r.valueInStock, 0)
  const countByStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status.label] = (acc[r.status.label] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Acessórios</h1>
      <AccessoryForm key={editingAccessory?.id ?? 'new'} accessoryTypes={accessoryTypes} editingAccessory={editingAccessory} />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Valor total em estoque</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(totalValueInStock)}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🟢 Em estoque</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countByStatus['Em estoque'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🟡 Estoque baixo</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countByStatus['Estoque baixo'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">🔴 Estoque crítico</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countByStatus['Estoque crítico'] ?? 0}</p>
        </div>
        <div className="tk-panel p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">⚫ Esgotados</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{countByStatus['Esgotado'] ?? 0}</p>
        </div>
      </div>

      <div className="mb-2 mt-6 flex flex-wrap gap-1">
        <Link href={buildHref({ stock: activeStock })} className={tabClass(!activeType)}>
          Todos
        </Link>
        {accessoryTypes.map((t) => (
          <Link key={t.id} href={buildHref({ type: t.id, stock: activeStock })} className={tabClass(activeType === t.id)}>
            {t.name}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        <Link href={buildHref({ type: activeType })} className={tabClass(!activeStock)}>
          Todos
        </Link>
        <Link href={buildHref({ type: activeType, stock: 'baixo' })} className={tabClass(activeStock === 'baixo')}>
          Estoque baixo
        </Link>
      </div>

      <table className="tk-table-zebra mt-2 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2"></th>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Cor</th>
            <th>Estoque</th>
            <th>Custo médio</th>
            <th>Valor em estoque</th>
            <th>% restante</th>
            <th>Status</th>
            <th>Repor estoque</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filteredMainRows.map(({ accessory: a, currentStock, avgUnitCost, valueInStock, percentRemaining, status }) => (
            <tr key={a.id} className="tk-row align-top">
              <td className="py-2">
                {a.colorHex && <span style={{ background: a.colorHex }} className="inline-block h-3 w-3 rounded-full" />}
              </td>
              <td>{a.name}</td>
              <td>{typeLabel(a.type)}</td>
              <td>{a.colorName || '—'}</td>
              <td>{currentStock}</td>
              <td>{formatCurrency(avgUnitCost)}</td>
              <td>{formatCurrency(valueInStock)}</td>
              <td>{percentRemaining.toFixed(1)}%</td>
              <td><StatusBadge badge={getStockStatusBadge(status)} /></td>
              <td>
                <RestockForm accessoryId={a.id} accessoryName={a.name} />
              </td>
              <td>
                <div className="flex flex-col items-start gap-1">
                  <details>
                    <summary className="tk-summary">Histórico ({a.purchases.length})</summary>
                    <table className="mt-2 text-xs">
                      <thead>
                        <tr className="tk-table-head-row">
                          <th className="pr-2">Data</th>
                          <th className="pr-2">Qtd</th>
                          <th className="pr-2">Valor total</th>
                          <th>R$/un</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.purchases.map((p) => (
                          <tr key={p.id} className="tk-row">
                            <td className="pr-2">{formatDate(p.purchaseDate)}</td>
                            <td className="pr-2">{p.quantity.toNumber()}</td>
                            <td className="pr-2">{formatCurrency(p.totalCost.toNumber())}</td>
                            <td>{formatCurrency(p.totalCost.toNumber() / p.quantity.toNumber())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(adjustmentsByAccessory.get(a.id) ?? []).length > 0 && (
                      <table className="mt-2 text-xs">
                        <thead>
                          <tr className="tk-table-head-row">
                            <th className="pr-2">Data</th>
                            <th className="pr-2">Ajuste</th>
                            <th className="pr-2">Motivo</th>
                            <th>Obs.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(adjustmentsByAccessory.get(a.id) ?? []).map((adj) => (
                            <tr key={adj.id} className="tk-row">
                              <td className="pr-2">{formatDate(adj.createdAt)}</td>
                              <td className="pr-2">{adj.difference.toNumber() > 0 ? '+' : ''}{adj.difference.toNumber()}</td>
                              <td className="pr-2">{STOCK_ADJUSTMENT_REASON_LABELS[adj.reason]}</td>
                              <td>{adj.reasonNote ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </details>
                  <ActionsMenu>
                    <Link href={`/accessories?editId=${a.id}`} className="text-amber-600 hover:underline dark:text-amber-400">
                      Editar
                    </Link>
                    <AdjustStockButton resourceType="ACCESSORY" resourceId={a.id} resourceName={a.name} currentQuantity={currentStock} />
                    <ConfirmDeleteForm action={async () => { 'use server'; await deleteAccessory(a.id) }} />
                  </ActionsMenu>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filteredMainRows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum acessório encontrado com esses filtros.
        </div>
      )}

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
