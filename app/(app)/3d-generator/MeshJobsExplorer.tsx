'use client'
import Script from 'next/script'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { createMeshJob, deleteMeshJob, getRecentMeshJobs } from '@/actions/meshJobs'
import { MESH_OCTREE_RESOLUTIONS, MESH_TEXTURE_RESOLUTIONS } from '@/lib/validation/meshJob'
import type { MeshJobSummary } from '@/lib/meshJobs/jobs'

const STATUS_LABEL: Record<MeshJobSummary['status'], string> = {
  PENDENTE: 'Pendente (esperando o worker)',
  PROCESSANDO: 'Processando no worker',
  CONCLUIDO: 'Concluído',
  ERRO: 'Erro',
}

function pillClass(active: boolean): string {
  return `tk-pill ${
    active
      ? 'border-violet-600 bg-violet-600 text-white dark:border-violet-500 dark:bg-violet-500 dark:text-slate-950'
      : 'border-slate-300 bg-white text-slate-700 hover:border-violet-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
  }`
}

export function MeshJobsExplorer({ initialJobs }: { initialJobs: MeshJobSummary[] }) {
  const [jobs, setJobs] = useState(initialJobs)
  // Painel direito sempre mostra o job "ativo" -- por padrão o mais
  // recente (jobs[0], já vem ordenado desc), mas vira o job recém-criado
  // assim que o upload termina, sem esperar o próximo poll.
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobs[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [generateTexture, setGenerateTexture] = useState(false)
  const [randomizeSeed, setRandomizeSeed] = useState(true)
  const [octreeResolution, setOctreeResolution] = useState<number>(384)
  const [textureResolution, setTextureResolution] = useState<number>(512)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null

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

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(file ? URL.createObjectURL(file) : null)
  }

  async function handleUpload(formData: FormData) {
    setError(null)
    const result = await createMeshJob(formData)
    if (!result.success) {
      setError(result.error ?? 'Falha ao enviar imagem')
      return
    }
    formRef.current?.reset()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setGenerateTexture(false)
    setRandomizeSeed(true)
    setOctreeResolution(384)
    setTextureResolution(512)
    if (result.jobId) setActiveJobId(result.jobId)
    setJobs(await getRecentMeshJobs())
  }

  async function handleDelete(id: string) {
    await deleteMeshJob(id)
    if (activeJobId === id) setActiveJobId(null)
    setJobs(await getRecentMeshJobs())
  }

  // Antes de enviar: mostra o preview local do arquivo escolhido (sem
  // round-trip). Depois: busca a imagem do job ativo no servidor -- pra
  // continuar aparecendo mesmo depois de recarregar a página.
  const promptImageSrc = previewUrl ?? (activeJobId ? `/api/mesh-jobs/${activeJobId}/download/input` : null)

  return (
    <div className="mt-6 grid gap-6">
      {/* <model-viewer> é um web component carregado via CDN (zero
          dependência npm nova) -- usado no preview do job ativo e nas
          linhas concluídas da lista abaixo. */}
      <Script type="module" src="https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js" strategy="lazyOnload" />

      <form ref={formRef} action={handleUpload} className="grid gap-6 lg:grid-cols-2">
        <div className="tk-panel flex flex-col gap-4 p-4">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Imagem</h2>

          {/* Borda tracejada aqui é intencional (sinaliza "área de
              upload/clicável", convenção estabelecida) -- diferente da
              caixa de preview ao lado, que não precisa de borda própria
              por já estar dentro do tk-panel. */}
          <label
            htmlFor="mesh-file-input"
            className="flex aspect-square max-h-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950"
          >
            {promptImageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview vem de blob: local ou de uma rota própria, next/image não ajuda aqui
              <img src={promptImageSrc} alt="Imagem de referência" className="h-full w-full object-contain" />
            ) : (
              <span className="px-4 text-center text-sm text-slate-400 dark:text-slate-500">
                Clique pra escolher uma imagem
              </span>
            )}
          </label>
          <input
            id="mesh-file-input"
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={handleFileChange}
            className="sr-only"
          />

          <div>
            <span className="text-sm">Resolução da malha</span>
            <div className="mt-1 flex gap-2">
              {MESH_OCTREE_RESOLUTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={octreeResolution === r}
                  onClick={() => setOctreeResolution(r)}
                  className={pillClass(octreeResolution === r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <input type="hidden" name="octreeResolution" value={octreeResolution} />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Seed</span>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <input
                  type="checkbox"
                  name="randomizeSeed"
                  checked={randomizeSeed}
                  onChange={(e) => setRandomizeSeed(e.target.checked)}
                />
                Aleatória
              </label>
            </div>
            <input
              type="number"
              name="seed"
              min={0}
              max={2147483647}
              disabled={randomizeSeed}
              placeholder="seed fixa"
              className="tk-input-full disabled:opacity-50"
            />
          </div>

          <label className="text-sm">
            Alvo de decimação (opcional)
            <input
              type="number"
              name="simplifyTarget"
              min={1000}
              max={2000000}
              placeholder="sem decimação"
              className="tk-input-full"
            />
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Nº máximo de faces na malha final -- reduz tamanho/ruído do arquivo.
            </span>
          </label>

          <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="generateTexture"
                checked={generateTexture}
                onChange={(e) => setGenerateTexture(e.target.checked)}
              />
              Gerar textura
            </label>
            <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
              Precisa de ~21GB de VRAM -- não roda na sua placa atual. Sem isso marcado, gera só a forma (malha sem
              cor), que funciona hoje.
            </span>
            {generateTexture && (
              <div className="mt-3">
                <span className="text-sm">Resolução da textura</span>
                <div className="mt-1 flex gap-2">
                  {MESH_TEXTURE_RESOLUTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={textureResolution === r}
                      onClick={() => setTextureResolution(r)}
                      className={pillClass(textureResolution === r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <input type="hidden" name="textureResolution" value={textureResolution} />
              </div>
            )}
          </div>

          <button type="submit" className="tk-btn-primary w-full">
            Gerar modelo 3D
          </button>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="tk-panel flex flex-col gap-3 p-4">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Preview</h2>
          <div className="flex aspect-square max-h-[480px] items-center justify-center overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-950">
            {!activeJob && (
              <span className="px-4 text-center text-sm text-slate-400 dark:text-slate-500">
                Envie uma imagem e gere um modelo
              </span>
            )}
            {activeJob && (activeJob.status === 'PENDENTE' || activeJob.status === 'PROCESSANDO') && (
              <span className="text-sm text-slate-500 dark:text-slate-400">{STATUS_LABEL[activeJob.status]}…</span>
            )}
            {activeJob && activeJob.status === 'ERRO' && (
              <div className="px-4 text-center">
                <span className="rounded-full border border-red-400 px-3 py-1 text-sm font-medium text-red-600 dark:border-red-500 dark:text-red-400">
                  Erro
                </span>
                {activeJob.errorMessage && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{activeJob.errorMessage}</p>
                )}
              </div>
            )}
            {activeJob && activeJob.status === 'CONCLUIDO' && activeJob.hasGlb && (
              <model-viewer
                src={`/api/mesh-jobs/${activeJob.id}/download/glb`}
                alt="Modelo 3D gerado"
                camera-controls
                auto-rotate
                shadow-intensity="1"
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
          {activeJob && activeJob.status === 'CONCLUIDO' && (
            <div className="flex gap-3">
              {activeJob.hasGlb && (
                <a href={`/api/mesh-jobs/${activeJob.id}/download/glb`} className="tk-link-success">
                  .glb
                </a>
              )}
              {activeJob.hasObj && (
                <a href={`/api/mesh-jobs/${activeJob.id}/download/obj`} className="tk-link-success">
                  .obj
                </a>
              )}
              {activeJob.hasStl && (
                <a href={`/api/mesh-jobs/${activeJob.id}/download/stl`} className="tk-link-success">
                  .stl
                </a>
              )}
            </div>
          )}
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
                <th>Download</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className={job.id === activeJobId ? 'tk-row bg-violet-50 dark:bg-violet-500/10' : 'tk-row'}>
                  <td className="py-2">
                    {job.id === activeJobId && (
                      <span className="mr-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">▸</span>
                    )}
                    {new Date(job.createdAt).toLocaleString('pt-BR')}
                  </td>
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
