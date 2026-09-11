import Link from 'next/link'
import { getAllLiveBambuStatuses, getBambuConnectionStatus } from '@/actions/bambuStatus'
import { LiveStatusPoller } from './LiveStatusPoller'

export const dynamic = 'force-dynamic'

export default async function MonitorPage() {
  const [printers, connectionStatus] = await Promise.all([getAllLiveBambuStatuses(), getBambuConnectionStatus()])

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Monitoramento</h1>

      {printers.length === 0 ? (
        <div className="tk-panel p-4 text-sm text-slate-500 dark:text-slate-400">
          Nenhuma impressora com integração Bambu habilitada. Configure em{' '}
          <Link href="/printers" className="underline">
            Impressoras
          </Link>
          .
        </div>
      ) : connectionStatus !== 'connected' ? (
        <div className="tk-panel p-4 text-sm text-amber-600 dark:text-amber-400">
          Integração Bambu Lab desconectada.{' '}
          <Link href="/settings" className="underline">
            Ver Configurações
          </Link>
          .
        </div>
      ) : (
        <LiveStatusPoller initialPrinters={printers} />
      )}
    </div>
  )
}
