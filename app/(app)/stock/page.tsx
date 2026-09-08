import Link from 'next/link'
import { getOwnStockSummary } from '@/lib/reports'

export const dynamic = 'force-dynamic'

export default async function StockPage() {
  const rows = await getOwnStockSummary()

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Meu Estoque</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Disponível = produzido − vendido diretamente − entregue a parceiros. Produto composto só soma ao estoque depois da montagem (em breve).
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
            <tr key={r.productId} className="tk-row">
              <td className="py-2">
                {r.productName}
                {r.isComposite && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    composto
                  </span>
                )}
              </td>
              <td>{r.produced}</td>
              <td>{r.soldDirect}</td>
              <td>{r.deliveredToPartners}</td>
              <td>{r.consignmentRemaining}</td>
              <td title="Depende do sistema de pedidos (em breve)">{r.inProduction}</td>
              <td className={`font-medium ${r.available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {r.available}
              </td>
              <td>
                <div className="flex items-center gap-3">
                  <Link href={`/sales?productId=${r.productId}`} className="text-amber-600 hover:underline dark:text-amber-400">
                    Registrar venda direta
                  </Link>
                  <Link href={`/consignment/deliveries?productId=${r.productId}`} className="text-amber-600 hover:underline dark:text-amber-400">
                    Entregar a parceiro
                  </Link>
                </div>
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
