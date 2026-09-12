import Link from 'next/link'
import { getBambuTaskHistory } from '@/actions/bambuStatus'
import { TaskHistoryList } from './TaskHistoryList'

export const dynamic = 'force-dynamic'

export default async function BambuHistoryPage() {
  const result = await getBambuTaskHistory()

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Histórico Bambu</h1>
      <p className="mb-4 -mt-2 text-xs text-slate-400 dark:text-slate-500">
        Histórico oficial da sua conta Bambu Lab, buscado ao vivo da nuvem — não é salvo no TK3D.
      </p>

      {!result.success ? (
        <div className="tk-panel p-4 text-sm text-amber-600 dark:text-amber-400">
          {result.error ?? 'Falha ao buscar histórico'}.{' '}
          <Link href="/settings" className="underline">
            Ver Configurações
          </Link>
          .
        </div>
      ) : (
        <TaskHistoryList initialTasks={result.tasks ?? []} initialCursor={result.nextCursor ?? null} />
      )}
    </div>
  )
}
