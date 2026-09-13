import Link from 'next/link'
import { getAnycubicProjectHistory } from '@/actions/anycubicStatus'
import { ProjectHistoryList } from './ProjectHistoryList'

export const dynamic = 'force-dynamic'

export default async function AnycubicHistoryPage() {
  const result = await getAnycubicProjectHistory()

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Histórico Anycubic</h1>
      <p className="mb-4 -mt-2 text-xs text-slate-400 dark:text-slate-500">
        Histórico oficial da sua conta Anycubic, buscado ao vivo da nuvem — não é salvo no TK3D.
      </p>

      {!result.success ? (
        <div className="tk-panel p-4 text-sm text-amber-600 dark:text-amber-400">
          {result.error ?? 'Falha ao buscar histórico'}.{' '}
          <Link href="/printers" className="underline">
            Ver Impressoras
          </Link>
          .
        </div>
      ) : (
        <ProjectHistoryList initialTasks={result.tasks ?? []} initialNextPage={result.nextPage ?? null} />
      )}
    </div>
  )
}
