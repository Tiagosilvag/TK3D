import Link from 'next/link'
import { getAllLiveStatuses } from '@/actions/bambuStatus'
import { LiveStatusPoller } from './LiveStatusPoller'

export const dynamic = 'force-dynamic'

export default async function MonitorPage() {
  const printers = await getAllLiveStatuses()

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Monitoramento</h1>

      {printers.length === 0 ? (
        <div className="tk-panel p-4 text-sm text-slate-500 dark:text-slate-400">
          Nenhuma impressora com integração Bambu ou Anycubic habilitada. Configure em{' '}
          <Link href="/printers" className="underline">
            Impressoras
          </Link>
          .
        </div>
      ) : (
        <LiveStatusPoller initialPrinters={printers} />
      )}
    </div>
  )
}
