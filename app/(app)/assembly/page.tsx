import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { getAssemblyStatus, getAssemblyOverview } from '@/actions/assembly'
import { ConfirmAssemblyForm } from './ConfirmAssemblyForm'
import { AssemblyOverview } from './AssemblyOverview'

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

  // Melhoria "Montagem" §6: alertas separados -- falta de PEÇA bloqueia
  // (vermelho), falta de componente só avisa (neutro), calculado aqui a
  // partir do que a tela de detalhe já carregou.
  const insufficientParts = status?.parts.filter((p) => p.maxUnitsFromThisPart <= 0) ?? []
  const lowStockComponents = status
    ? [...status.accessoryRequirements, ...status.supplyRequirements, ...status.packagingRequirements].filter((r) => r.available < r.quantityPerUnit)
    : []

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Montagem</h1>

      <AssemblyOverview rows={overview} />

      {overview.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto com peça, insumo ou acessório cadastrado ainda.
        </div>
      )}

      {status && (
        <div className="mt-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{status.productName}</h2>

          {/* Melhoria "Montagem" §3: "Já montado" vira card de resumo, ao
              lado de "Disponível para montagem" -- antes era coluna dentro
              da tabela de peças. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="tk-panel p-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Já montado</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{status.alreadyAssembled} unidade{status.alreadyAssembled === 1 ? '' : 's'}</p>
            </div>
            <div className="tk-panel p-4">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Disponível para montagem</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${status.maxAssemblableUnits > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {status.maxAssemblableUnits} unidade{status.maxAssemblableUnits === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          {/* Melhoria "Montagem" §4: sem título "Peças" (a tabela já é
              autoexplicativa), sem coluna "Já montado" (virou card acima),
              com a cor do filamento impresso numa segunda linha. */}
          <div className="tk-panel p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="tk-table-head-row">
                  <th className="py-2">{status.isComposite ? 'Peça' : 'Impressão'}</th>
                  <th>Qtd/unidade</th>
                  <th>Produzido</th>
                  <th>Disponível</th>
                </tr>
              </thead>
              <tbody>
                {status.parts.map((part) => {
                  const repColor = part.colorOptions && part.colorOptions.length > 0
                    ? part.colorOptions.reduce((a, b) => (b.available > a.available ? b : a))
                    : null
                  return (
                    <tr key={part.partId} className={`tk-row align-top ${part.maxUnitsFromThisPart <= 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                      <td className="py-2">
                        {part.name}
                        {repColor && (
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                            {repColor.colorHex && <span style={{ background: repColor.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                            {repColor.label}
                          </span>
                        )}
                      </td>
                      <td>{part.quantityPerUnit}</td>
                      <td>{part.produced}</td>
                      <td>{part.available}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {insufficientParts.length > 0 && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-500/10 dark:text-red-400">
              ⚠ Peça insuficiente: {insufficientParts.map((p) => p.name).join(', ')}
            </p>
          )}

          <ConfirmAssemblyForm
            productId={status.productId}
            parts={status.parts}
            accessoryRequirements={status.accessoryRequirements}
            supplyRequirements={status.supplyRequirements}
            packagingRequirements={status.packagingRequirements}
            allAccessories={allAccessories.map((a) => ({ id: a.id, name: a.name, colorName: a.colorName, available: Math.max(0, a.currentStock.toNumber()) }))}
            allSupplies={allSupplies.map((s) => ({ id: s.id, name: s.name, unit: s.unit, available: Math.max(0, s.currentStock.toNumber()), catalogDefaultUsage: s.defaultUsage?.toNumber() ?? null }))}
            allPackaging={allPackaging.map((p) => ({ id: p.id, name: p.name, available: Math.max(0, p.currentStock.toNumber()) }))}
          />

          {lowStockComponents.length > 0 && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              ⓘ Estoque baixo de: {lowStockComponents.map((r) => r.name).join(', ')}
            </p>
          )}

          <Link href="/stock" className="inline-block text-sm text-amber-600 hover:underline dark:text-amber-400">
            Ver Meu Estoque &rarr;
          </Link>
        </div>
      )}
    </div>
  )
}
