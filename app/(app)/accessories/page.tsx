import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'
import { getStockStatusWithThresholds, calculateStockReferenceQuantity, calculateStockPercentRemaining } from '@/lib/costing'
import { AccessoryForm } from './AccessoryForm'
import { RestockForm } from './RestockForm'
import { deleteAccessory } from '@/actions/accessories'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import type { AccessoryType } from '@prisma/client'

export const dynamic = 'force-dynamic'

const ACCESSORY_TYPE_LABELS: Record<AccessoryType, string> = {
  CORRENTE_BOLINHA: 'Corrente bolinha',
  CORRENTE_ELO: 'Corrente elo',
  MOSQUETAO: 'Mosquetão',
  CLICKER: 'Clicker',
  OUTRO: 'Outro',
}

const TYPE_FILTERS: { value: AccessoryType | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  { value: 'CORRENTE_BOLINHA', label: 'Corrente bolinha' },
  { value: 'CORRENTE_ELO', label: 'Corrente elo' },
  { value: 'MOSQUETAO', label: 'Mosquetão' },
  { value: 'CLICKER', label: 'Clicker' },
  { value: 'OUTRO', label: 'Outro' },
]

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
  searchParams: Promise<{ type?: string; stock?: string }>
}) {
  const { type, stock } = await searchParams
  const activeType = (['CORRENTE_BOLINHA', 'CORRENTE_ELO', 'MOSQUETAO', 'CLICKER', 'OUTRO'] as const).includes(type as AccessoryType)
    ? (type as AccessoryType)
    : undefined
  const activeStock = stock === 'baixo' ? 'baixo' : undefined

  const [accessories, settings] = await Promise.all([
    prisma.accessory.findMany({
      include: { purchases: { orderBy: { purchaseDate: 'desc' } } },
      orderBy: [{ name: 'asc' }, { colorName: 'asc' }],
    }),
    prisma.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ])

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
      <AccessoryForm />

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
        {TYPE_FILTERS.map((f) => (
          <Link key={f.label} href={buildHref({ type: f.value, stock: activeStock })} className={tabClass(activeType === f.value)}>
            {f.label}
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

      <table className="mt-2 w-full text-sm">
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
              <td>{ACCESSORY_TYPE_LABELS[a.type] ?? a.type}</td>
              <td>{a.colorName || '—'}</td>
              <td>{currentStock}</td>
              <td>{formatCurrency(avgUnitCost)}</td>
              <td>{formatCurrency(valueInStock)}</td>
              <td>{percentRemaining.toFixed(1)}%</td>
              <td>{status.emoji} {status.label}</td>
              <td>
                <RestockForm accessoryId={a.id} />
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
                  </details>
                  <ConfirmDeleteForm action={async () => { 'use server'; await deleteAccessory(a.id) }} />
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
          <table className="mt-3 w-full text-sm">
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
                  <td>{ACCESSORY_TYPE_LABELS[a.type] ?? a.type}</td>
                  <td>{a.colorName || '—'}</td>
                  <td>{formatCurrency(avgUnitCost)}</td>
                  <td>
                    <RestockForm accessoryId={a.id} />
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
