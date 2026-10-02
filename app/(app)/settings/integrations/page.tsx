import { buildAuthorizationUrl } from '@/lib/mercadoLivre/auth'
import { getConnectionStatus } from '@/lib/mercadoLivre/connection'
import { disconnectMercadoLivre } from '@/actions/mercadoLivreAuth'

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
    </div>
  )
}
