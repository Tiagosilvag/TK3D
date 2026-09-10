import Link from 'next/link'
import { getOwnStockSummary, getProductVariantBreakdown } from '@/lib/reports'
import { AdjustStockButton } from '@/components/AdjustStockButton'
import { ActionsMenu } from '@/components/ActionsMenu'

export const dynamic = 'force-dynamic'

export default async function StockPage() {
  const rows = await getOwnStockSummary()
  // Bug "cor no produto simples": breakdown por variante busca pra TODO
  // produto agora, não só composto -- peça única também pode ter sido
  // produzida em mais de uma cor (getProductVariantBreakdown decide a
  // fonte certa a partir de needsAssembly: ProductAssembly.colorChoices
  // quando passa por Montagem, ProductionRun.filamentId direto quando
  // vai reto de Produção pro estoque).
  const variantBreakdowns = await Promise.all(
    rows.map(async (r) => [r.productId, await getProductVariantBreakdown(r.productId, r.needsAssembly)] as const),
  )
  const variantBreakdownMap = new Map(variantBreakdowns)

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Meu Estoque</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Disponível = produzido − vendido diretamente − entregue a parceiros (+ ajustes). Produto que precisa de montagem (composto, ou com insumo/acessório cadastrado) só soma ao estoque depois da montagem confirmada.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Produto</th>
            <th>Produzido</th>
            <th>Vendido (direta)</th>
            <th>Entregue a parceiros</th>
            <th>Em consignação</th>
            <th>Em produção</th>
            <th>Disponível</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId} className="tk-row align-top">
              <td className="py-2">
                {r.productName}
                {r.isComposite && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    composto
                  </span>
                )}
                {r.needsAssembly && (
                  <Link
                    href={`/assembly?productId=${r.productId}`}
                    className="ml-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:underline dark:bg-amber-500/10 dark:text-amber-400"
                  >
                    precisa de montagem
                  </Link>
                )}
              </td>
              <td>
                {r.produced}
                {(variantBreakdownMap.get(r.productId)?.length ?? 0) > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400">Por variante</summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {variantBreakdownMap.get(r.productId)!.map((v) => (
                        <li key={v.label}>{v.label}: {v.quantity}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </td>
              <td>{r.soldDirect}</td>
              <td>{r.deliveredToPartners}</td>
              <td>{r.consignmentRemaining}</td>
              <td title="Soma de pedidos ainda não concluídos (2.4)">{r.inProduction}</td>
              <td className={`font-medium ${r.available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {r.available}
              </td>
              <td>
                <ActionsMenu>
                  <Link href={`/sales?productId=${r.productId}`} className="text-amber-600 hover:underline dark:text-amber-400">
                    Registrar venda direta
                  </Link>
                  <Link href={`/consignment/deliveries?productId=${r.productId}`} className="text-amber-600 hover:underline dark:text-amber-400">
                    Entregar a parceiro
                  </Link>
                  <AdjustStockButton resourceType="PRODUCT" resourceId={r.productId} resourceName={r.productName} currentQuantity={r.available} />
                </ActionsMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum produto ativo cadastrado.
        </div>
      )}
    </div>
  )
}
