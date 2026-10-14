import { prisma } from '@/lib/prisma'
import type { Model3DJob, Model3DJobStatus } from '@prisma/client'

const STALE_AFTER_MS = 15 * 60 * 1000

export interface CreateJobInput {
  data: Buffer
  contentType: string
  sizeBytes: number
}

export async function createJob(input: CreateJobInput): Promise<Model3DJob> {
  return prisma.model3DJob.create({
    data: {
      inputImage: input.data,
      inputContentType: input.contentType,
      inputSizeBytes: input.sizeBytes,
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

export async function completeJob(id: string, obj: Buffer, stl: Buffer): Promise<void> {
  await prisma.model3DJob.update({
    where: { id },
    data: { status: 'CONCLUIDO', outputObj: obj, outputStl: stl, errorMessage: null },
  })
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

export async function getJobOutput(id: string, kind: 'obj' | 'stl'): Promise<Buffer | null> {
  const job = await prisma.model3DJob.findUnique({
    where: { id },
    select: { outputObj: true, outputStl: true },
  })
  if (!job) return null
  const value = kind === 'obj' ? job.outputObj : job.outputStl
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
  hasObj: boolean
  hasStl: boolean
}

// Lista pra tela -- nunca devolve os Bytes de entrada/saída pro caller,
// só se existem (hasObj/hasStl), evitando carregar potencialmente vários
// MB por job numa lista de até `limit` itens.
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
      outputObj: true,
      outputStl: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    inputContentType: r.inputContentType,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    hasObj: r.outputObj !== null,
    hasStl: r.outputStl !== null,
  }))
}
