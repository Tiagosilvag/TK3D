import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getAssemblyStatus } from '@/actions/assembly'
import { ConfirmAssemblyForm } from './ConfirmAssemblyForm'
import { ProductPicker } from './ProductPicker'

export const dynamic = 'force-dynamic'

export default async function AssemblyPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>
}) {
  const { productId } = await searchParams

  // Ajuste "produção → montagem → estoque": Montagem lista todo produto
  // ativo que precisa passar por aqui antes do estoque -- composto (várias
  // peças) OU simples com insumo/acessório cadastrado. Peça única sem
  // nenhum componente nunca aparece (vai direto de Produção pro estoque).
  const assemblableProducts = await prisma.product.findMany({
    where: {
      active: true,
      OR: [{ isComposite: true }, { accessoryUsages: { some: {} } }, { supplyUsages: { some: {} } }],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  const [status, allAccessories, allSupplies] = await Promise.all([
    productId ? getAssemblyStatus(productId) : Promise.resolve(null),
    prisma.accessory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.supply.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Montagem</h1>

      <ProductPicker productId={productId} products={assemblableProducts} />

      {assemblableProducts.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto com peça, insumo ou acessório cadastrado ainda.
        </div>
      )}

      {status && (
        <div className="space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">{status.isComposite ? 'Peça' : 'Impressão'}</th>
                <th>Qtd. por unidade</th>
                <th>Já montado</th>
                <th>Disponível</th>
                <th>Dá pra montar</th>
              </tr>
            </thead>
            <tbody>
              {status.parts.map((part) => (
                <tr key={part.partId} className={`tk-row align-top ${part.maxUnitsFromThisPart <= 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                  <td className="py-2">{part.name}</td>
                  <td>{part.quantityPerUnit}</td>
                  <td>{part.consumed}</td>
                  <td>
                    {part.available}
                    {/* Ajuste "cor na montagem": peça de cor variável mostra
                        o total disponível quebrado por cor. */}
                    {part.colorOptions && part.colorOptions.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {part.colorOptions.map((c) => (
                          <li key={c.key} className={c.available <= 0 ? 'text-red-500 dark:text-red-400' : undefined}>
                            {c.label}: {c.available}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{part.maxUnitsFromThisPart} unidade{part.maxUnitsFromThisPart === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Ajuste "produção → montagem → estoque": insumo/acessório
              cadastrados também travam quanto dá pra montar -- mostrados
              aqui só pra referência, a quantidade real usada nesta leva é
              editável no formulário de confirmação abaixo. */}
          {(status.accessoryRequirements.length > 0 || status.supplyRequirements.length > 0) && (
            <table className="w-full text-sm">
              <thead>
                <tr className="tk-table-head-row">
                  <th className="py-2">Insumo/Acessório</th>
                  <th>Qtd. por unidade</th>
                  <th>Disponível</th>
                </tr>
              </thead>
              <tbody>
                {[...status.accessoryRequirements, ...status.supplyRequirements].map((r) => {
                  const maxUnits = Math.floor(r.available / r.quantityPerUnit)
                  return (
                    <tr key={r.id} className={`tk-row ${maxUnits <= 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                      <td className="py-2">{r.name}</td>
                      <td>{r.quantityPerUnit}</td>
                      <td>{r.available}{r.unit ? ` ${r.unit.toLowerCase()}` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {status.maxAssemblableUnits > 0 ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              ✓ Tudo disponível — dá pra montar até {status.maxAssemblableUnits} unidade{status.maxAssemblableUnits === 1 ? '' : 's'} agora.
            </p>
          ) : (
            <p className="text-sm text-red-600 dark:text-red-400">
              ⚠️ Peça(s)/insumo(s)/acessório(s) insuficiente(s) — reponha antes de montar (veja destacado em vermelho acima).
            </p>
          )}

          <ConfirmAssemblyForm
            productId={status.productId}
            parts={status.parts}
            accessoryRequirements={status.accessoryRequirements}
            supplyRequirements={status.supplyRequirements}
            allAccessories={allAccessories.map((a) => ({ id: a.id, name: a.colorName ? `${a.name} — ${a.colorName}` : a.name, available: Math.max(0, a.currentStock.toNumber()) }))}
            allSupplies={allSupplies.map((s) => ({ id: s.id, name: s.name, unit: s.unit, available: Math.max(0, s.currentStock.toNumber()) }))}
          />

          <Link href="/stock" className="inline-block text-sm text-amber-600 hover:underline dark:text-amber-400">
            Ver Meu Estoque &rarr;
          </Link>
        </div>
      )}
    </div>
  )
}
