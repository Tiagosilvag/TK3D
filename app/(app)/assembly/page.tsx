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

  const compositeProducts = await prisma.product.findMany({
    where: { active: true, isComposite: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  const status = productId ? await getAssemblyStatus(productId) : null

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Montagem</h1>

      <ProductPicker productId={productId} products={compositeProducts} />

      {compositeProducts.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto composto cadastrado ainda.
        </div>
      )}

      {status && (
        <div className="space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Peça</th>
                <th>Qtd. por unidade</th>
                <th>Produzido</th>
                <th>Já montado</th>
                <th>Disponível</th>
                <th>Dá pra montar</th>
              </tr>
            </thead>
            <tbody>
              {status.parts.map((part) => (
                <tr key={part.partId} className={`tk-row ${part.maxUnitsFromThisPart <= 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                  <td className="py-2">{part.name}</td>
                  <td>{part.quantityPerUnit}</td>
                  <td>{part.produced}</td>
                  <td>{part.consumed}</td>
                  <td>{part.available}</td>
                  <td>{part.maxUnitsFromThisPart} unidade{part.maxUnitsFromThisPart === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {status.maxAssemblableUnits > 0 ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              ✓ Todas as peças disponíveis — dá pra montar até {status.maxAssemblableUnits} unidade{status.maxAssemblableUnits === 1 ? '' : 's'} agora.
            </p>
          ) : (
            <p className="text-sm text-red-600 dark:text-red-400">
              ⚠️ Peça(s) insuficiente(s) — produza mais antes de montar (veja destacado em vermelho acima).
            </p>
          )}

          <ConfirmAssemblyForm productId={status.productId} maxAssemblableUnits={status.maxAssemblableUnits} />

          <Link href="/stock" className="inline-block text-sm text-amber-600 hover:underline dark:text-amber-400">
            Ver Meu Estoque &rarr;
          </Link>
        </div>
      )}
    </div>
  )
}
