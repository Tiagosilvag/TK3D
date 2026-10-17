import { prisma } from '@/lib/prisma'
import type { Model3DJob, Model3DJobStatus } from '@prisma/client'

const STALE_AFTER_MS = 15 * 60 * 1000

export interface CreateJobInput {
  data: Buffer
  contentType: string
  sizeBytes: number
  generateTexture: boolean
  seed: number | null
  octreeResolution: number
  textureResolution: number
  simplifyTarget: number | null
}

export async function createJob(input: CreateJobInput): Promise<Model3DJob> {
  return prisma.model3DJob.create({
    data: {
      inputImage: input.data,
      inputContentType: input.contentType,
      inputSizeBytes: input.sizeBytes,
      generateTexture: input.generateTexture,
      seed: input.seed,
      octreeResolution: input.octreeResolution,
      textureResolution: input.textureResolution,
      simplifyTarget: input.simplifyTarget,
    },
  })
}

// Reivindica atomicamente o job disponível mais antigo por createdAt --
// candidato é todo job PENDENTE, OU PROCESSANDO com claimedAt há mais de
// STALE_AFTER_MS (abandonado por um worker que crashou sem chamar
// /fail). O updateMany condicional (where inclui o status visto na
// leitura) é o claim atômico -- se outra chamada já reivindicou o mesmo
// candidato entre o findFirst e o updateMany, count fica 0 e tenta o
// próximo (mesmo padrão já usado em confirmInboxOrder/ignoreInboxOrder
// na integração Mercado Livre). Com um único worker (PC do usuário) essa
// corrida nunca deveria acontecer de verdade, mas o loop cobre o caso
// mesmo assim.
export async function claimNextJob(): Promise<Model3DJob | null> {
  const staleThreshold = new Date(Date.now() - STALE_AFTER_MS)

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await prisma.model3DJob.findFirst({
      where: {
        OR: [{ status: 'PENDENTE' }, { status: 'PROCESSANDO', claimedAt: { lt: staleThreshold } }],
      },
      orderBy: { createdAt: 'asc' },
    })
    if (!candidate) return null

    const claim = await prisma.model3DJob.updateMany({
      where: { id: candidate.id, status: candidate.status },
      data: { status: 'PROCESSANDO', claimedAt: new Date() },
    })
    if (claim.count === 1) {
      return prisma.model3DJob.findUniqueOrThrow({ where: { id: candidate.id } })
    }
  }
  return null
}

// Grava UM arquivo de saída por vez (não os 3 juntos) -- o worker manda
// obj/stl/glb em requisições HTTP separadas (ver worker/mesh_worker.py)
// porque o proxy de produção rejeita com 413 Payload Too Large quando os
// 3 vão juntos num multipart só (o .obj em ASCII sozinho já é grande pra
// uma malha de resolução média). Marca CONCLUIDO só quando os 3 já
// chegaram -- enquanto isso o job continua aparecendo como PROCESSANDO,
// sem problema (é exatamente o que a tela já mostra durante a geração).
export async function saveJobOutputPart(id: string, kind: 'obj' | 'stl' | 'glb', data: Buffer): Promise<void> {
  const partial = kind === 'obj' ? { outputObj: data } : kind === 'stl' ? { outputStl: data } : { outputGlb: data }
  const updated = await prisma.model3DJob.update({
    where: { id },
    data: { ...partial, errorMessage: null },
    select: { outputObj: true, outputStl: true, outputGlb: true },
  })
  if (updated.outputObj && updated.outputStl && updated.outputGlb) {
    await prisma.model3DJob.update({ where: { id }, data: { status: 'CONCLUIDO' } })
  }
}

export async function failJob(id: string, message: string): Promise<void> {
  await prisma.model3DJob.update({
    where: { id },
    data: { status: 'ERRO', errorMessage: message },
  })
}

export async function getJobImage(id: string): Promise<{ data: Buffer; contentType: string } | null> {
  const job = await prisma.model3DJob.findUnique({
    where: { id },
    select: { inputImage: true, inputContentType: true },
  })
  if (!job) return null
  return { data: Buffer.from(job.inputImage), contentType: job.inputContentType }
}

export async function getJobOutput(id: string, kind: 'obj' | 'stl' | 'glb'): Promise<Buffer | null> {
  const job = await prisma.model3DJob.findUnique({
    where: { id },
    select: { outputObj: true, outputStl: true, outputGlb: true },
  })
  if (!job) return null
  const value = kind === 'obj' ? job.outputObj : kind === 'stl' ? job.outputStl : job.outputGlb
  return value ? Buffer.from(value) : null
}

export async function deleteJob(id: string): Promise<void> {
  await prisma.model3DJob.delete({ where: { id } })
}

export interface MeshJobSummary {
  id: string
  status: Model3DJobStatus
  inputContentType: string
  errorMessage: string | null
  createdAt: string
  generateTexture: boolean
  seed: number | null
  hasObj: boolean
  hasStl: boolean
  hasGlb: boolean
}

// Lista pra tela -- nunca devolve os Bytes de entrada/saída pro caller,
// só se existem (hasObj/hasStl/hasGlb), evitando carregar potencialmente
// vários MB por job numa lista de até `limit` itens. outputGlb some do
// select por esse mesmo motivo -- quem precisa do conteúdo do .glb pro
// preview usa a rota de download, não esta lista.
export async function listRecentJobs(limit = 20): Promise<MeshJobSummary[]> {
  const rows = await prisma.model3DJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      inputContentType: true,
      errorMessage: true,
      createdAt: true,
      generateTexture: true,
      seed: true,
      outputObj: true,
      outputStl: true,
      outputGlb: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    inputContentType: r.inputContentType,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    generateTexture: r.generateTexture,
    seed: r.seed,
    hasObj: r.outputObj !== null,
    hasStl: r.outputStl !== null,
    hasGlb: r.outputGlb !== null,
  }))
}
