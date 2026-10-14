'use client'
import { useEffect, useRef, useState } from 'react'
import { createMeshJob, deleteMeshJob, getRecentMeshJobs } from '@/actions/meshJobs'
import type { MeshJobSummary } from '@/lib/meshJobs/jobs'

const STATUS_LABEL: Record<MeshJobSummary['status'], string> = {
  PENDENTE: 'Pendente (esperando o worker)',
  PROCESSANDO: 'Processando no worker',
  CONCLUIDO: 'Concluído',
  ERRO: 'Erro',
}

export function MeshJobsExplorer({ initialJobs }: { initialJobs: MeshJobSummary[] }) {
  const [jobs, setJobs] = useState(initialJobs)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Enquanto existir job PENDENTE/PROCESSANDO, repoll a cada 5s (mesmo
  // princípio de LiveStatusPoller.tsx: chama a própria Server Action de
  // dentro do setInterval, sem round-trip de navegação) -- para de
  // repollar sozinho quando não há mais nada em andamento.
  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === 'PENDENTE' || j.status === 'PROCESSANDO')
    if (!hasPending) return
    const interval = setInterval(async () => {
      setJobs(await getRecentMeshJobs())
    }, 5000)
    return () => clearInterval(interval)
  }, [jobs])

  async function handleUpload(formData: FormData) {
    setError(null)
    const result = await createMeshJob(formData)
    if (!result.success) {
      setError(result.error ?? 'Falha ao enviar imagem')
      return
    }
    formRef.current?.reset()
    setJobs(await getRecentMeshJobs())
  }

  async function handleDelete(id: string) {
    await deleteMeshJob(id)
    setJobs(await getRecentMeshJobs())
  }

  return (
    <div className="mt-6 grid gap-6">
      <form ref={formRef} action={handleUpload} className="tk-panel flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          Imagem
          <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required className="tk-input-full mt-1" />
        </label>
        <button type="submit" className="tk-btn-primary">
          Gerar modelo 3D
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>

      <div className="tk-panel p-4">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Jobs recentes</h2>
        {jobs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Nenhum job ainda.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="tk-table-head-row">
                <th className="py-2">Criado em</th>
                <th>Status</th>
                <th>Download</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="tk-row">
                  <td className="py-2">{new Date(job.createdAt).toLocaleString('pt-BR')}</td>
                  <td>
                    {STATUS_LABEL[job.status]}
                    {job.status === 'ERRO' && job.errorMessage && (
                      <span className="block text-xs text-red-600 dark:text-red-400">{job.errorMessage}</span>
                    )}
                  </td>
                  <td>
                    {job.hasObj && (
                      <a href={`/api/mesh-jobs/${job.id}/download/obj`} className="tk-link-success mr-2">
                        .obj
                      </a>
                    )}
                    {job.hasStl && (
                      <a href={`/api/mesh-jobs/${job.id}/download/stl`} className="tk-link-success">
                        .stl
                      </a>
                    )}
                  </td>
                  <td>
                    <button type="button" onClick={() => handleDelete(job.id)} className="tk-link-danger">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
