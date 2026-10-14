import { getRecentMeshJobs } from '@/actions/meshJobs'
import { MeshJobsExplorer } from './MeshJobsExplorer'

export const dynamic = 'force-dynamic'

export default async function MeshGeneratorPage() {
  const jobs = await getRecentMeshJobs()
  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Gerador de modelo 3D</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Sobe uma imagem e gera um modelo 3D a partir dela usando o worker local (TripoSR, roda no seu PC com GPU —
        a VPS do TK3D não processa isso). O resultado é um RASCUNHO de malha reconstruída a partir de 1 única foto:
        normalmente precisa de limpeza numa ferramenta de modelagem antes de virar um arquivo pronto pra imprimir.
      </p>
      <MeshJobsExplorer initialJobs={jobs} />
    </div>
  )
}
