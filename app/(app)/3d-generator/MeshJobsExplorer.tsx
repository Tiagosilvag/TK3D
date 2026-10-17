'use client'
import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'
import { createMeshJob, deleteMeshJob, getRecentMeshJobs } from '@/actions/meshJobs'
import { MESH_OCTREE_RESOLUTIONS, MESH_TEXTURE_RESOLUTIONS } from '@/lib/validation/meshJob'
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
  const [generateTexture, setGenerateTexture] = useState(false)
  const [randomizeSeed, setRandomizeSeed] = useState(true)
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
    setGenerateTexture(false)
    setRandomizeSeed(true)
    setJobs(await getRecentMeshJobs())
  }

  async function handleDelete(id: string) {
    await deleteMeshJob(id)
    setJobs(await getRecentMeshJobs())
  }

  return (
    <div className="mt-6 grid gap-6">
      {/* <model-viewer> é um web component carregado via CDN (zero
          dependência npm nova) -- usado só nas linhas de job concluído
          com outputGlb, mais abaixo. */}
      <Script type="module" src="https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js" strategy="lazyOnload" />

      <form ref={formRef} action={handleUpload} className="tk-panel grid gap-4 p-4">
        <label className="text-sm">
          Imagem
          <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required className="tk-input-full mt-1" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Resolução da malha
            <select name="octreeResolution" defaultValue={384} className="tk-input-full mt-1">
              {MESH_OCTREE_RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} {r === 384 ? '(padrão)' : r === 256 ? '(mais rápido)' : '(mais detalhe)'}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Alvo de decimação (opcional)
            <input
              type="number"
              name="simplifyTarget"
              min={1000}
              max={2000000}
              placeholder="sem decimação"
              className="tk-input-full mt-1"
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Nº máximo de faces na malha final -- reduz tamanho/ruído do arquivo.
            </span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="randomizeSeed"
                checked={randomizeSeed}
                onChange={(e) => setRandomizeSeed(e.target.checked)}
              />
              Seed aleatória
            </label>
            <input
              type="number"
              name="seed"
              min={0}
              max={2147483647}
              disabled={randomizeSeed}
              placeholder="seed fixa"
              className="tk-input-full mt-1 disabled:opacity-50"
            />
          </div>

          <div className="text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="generateTexture"
                checked={generateTexture}
                onChange={(e) => setGenerateTexture(e.target.checked)}
              />
              Gerar textura
            </label>
            <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
              Precisa de ~21GB de VRAM -- não roda na sua placa atual. Fica aqui pronto pra quando você trocar de GPU;
              sem isso marcado, gera só a forma (malha sem cor), que funciona hoje.
            </span>
          </div>
        </div>

        {generateTexture && (
          <label className="text-sm sm:w-1/2">
            Resolução da textura
            <select name="textureResolution" defaultValue={512} className="tk-input-full mt-1">
              {MESH_TEXTURE_RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}

        <div>
          <button type="submit" className="tk-btn-primary">
            Gerar modelo 3D
          </button>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
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
                <th>Config</th>
                <th>Preview</th>
                <th>Download</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="tk-row align-top">
                  <td className="py-2">{new Date(job.createdAt).toLocaleString('pt-BR')}</td>
                  <td>
                    {STATUS_LABEL[job.status]}
                    {job.status === 'ERRO' && job.errorMessage && (
                      <span className="block text-xs text-red-600 dark:text-red-400">{job.errorMessage}</span>
                    )}
                  </td>
                  <td className="text-xs text-slate-500 dark:text-slate-400">
                    {job.generateTexture ? 'c/ textura' : 'só forma'}
                    {job.seed !== null && <span className="block">seed {job.seed}</span>}
                  </td>
                  <td>
                    {job.hasGlb ? (
                      <model-viewer
                        src={`/api/mesh-jobs/${job.id}/download/glb`}
                        alt={`Preview do modelo 3D gerado no job ${job.id}`}
                        camera-controls
                        auto-rotate
                        shadow-intensity="1"
                        style={{ width: '140px', height: '140px', backgroundColor: 'transparent' }}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {job.hasGlb && (
                      <a href={`/api/mesh-jobs/${job.id}/download/glb`} className="tk-link-success mr-2">
                        .glb
                      </a>
                    )}
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
