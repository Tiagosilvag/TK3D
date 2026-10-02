import { buildAuthorizationUrl } from '@/lib/mercadoLivre/auth'
import { getConnectionStatus, getValidAccessToken } from '@/lib/mercadoLivre/connection'
import { fetchActiveListings, type MLListingSummary } from '@/lib/mercadoLivre/listings'
import { disconnectMercadoLivre } from '@/actions/mercadoLivreAuth'
import { formatCurrency } from '@/lib/format'

export const dynamic = 'force-dynamic'

// Classes reais do design system (ver app/globals.css e
// app/(app)/settings/{Bambu,Anycubic}ConnectionForm.tsx, mesmo padrão de
// painel "Integração <serviço>" dentro de Configurações): não existe
// `tk-alert-success`/`tk-alert-error`/`tk-section-title`/`tk-btn-danger` no
// CSS -- usamos text-emerald-600/text-red-600 (mesmas cores de
// STATUS_BADGE nas conexões Bambu/Anycubic) pra sucesso/erro, o padrão real
// de título de painel (`font-display text-sm font-semibold ...`) e
// `tk-link-danger` (ação destrutiva em formato de link, mesmo visual usado
// em "Desconectar" nas outras integrações) no lugar de um `tk-btn-danger`
// que não existe.
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ conectado?: string; erro?: string }>
}) {
  const { conectado, erro } = await searchParams
  const connection = await getConnectionStatus()

  let listings: MLListingSummary[] | null = null
  let listingsError = false
  if (connection?.status === 'CONECTADA') {
    try {
      const token = await getValidAccessToken()
      listings = await fetchActiveListings(token, connection.sellerId)
    } catch {
      listingsError = true
    }
  }

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Integrações</h1>

      {conectado && <p className="mb-4 text-sm font-medium text-emerald-600 dark:text-emerald-400">Mercado Livre conectado com sucesso.</p>}
      {erro && <p className="mb-4 text-sm font-medium text-red-600 dark:text-red-400">{erro}</p>}

      <section className="tk-panel p-4">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Mercado Livre</h2>
        {!connection || connection.status === 'DESCONECTADA' ? (
          <div className="mt-4">
            {connection?.status === 'DESCONECTADA' && (
              <p className="mb-3 text-sm text-red-600 dark:text-red-400">
                Conexão perdida{connection.lastError ? `: ${connection.lastError}` : ''}. Reconecte abaixo.
              </p>
            )}
            <a href={buildAuthorizationUrl()} className="tk-btn-primary">
              Conectar Mercado Livre
            </a>
          </div>
        ) : (
          <div className="mt-4 text-sm text-slate-700 dark:text-slate-300">
            <p>
              Conectado desde {connection.connectedAt.toLocaleDateString('pt-BR')} (vendedor {connection.sellerId})
            </p>
            <form
              action={async () => {
                'use server'
                await disconnectMercadoLivre()
              }}
              className="mt-2"
            >
              <button type="submit" className="tk-link-danger text-sm font-medium">
                Desconectar
              </button>
            </form>
          </div>
        )}
      </section>

      {connection?.status === 'CONECTADA' && (
        <section className="tk-panel mt-6 p-4">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Anúncios ativos no Mercado Livre</h2>
          {listingsError ? (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">Não foi possível carregar os anúncios agora.</p>
          ) : listings && listings.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Nenhum anúncio ativo encontrado.</p>
          ) : listings ? (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="tk-table-head-row">
                  <th className="py-2">Título</th>
                  <th>Preço</th>
                  <th>Estoque anunciado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => (
                  <tr key={listing.id} className="tk-row">
                    <td className="py-2">{listing.title}</td>
                    <td>{formatCurrency(listing.price)}</td>
                    <td>{listing.availableQuantity}</td>
                    <td>
                      <a href={listing.permalink} target="_blank" rel="noopener noreferrer" className="tk-link-success">
                        Ver anúncio
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      )}
    </div>
  )
}
