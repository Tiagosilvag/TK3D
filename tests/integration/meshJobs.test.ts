import { describe, it, expect, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createJob, claimNextJob, completeJob, failJob, listRecentJobs, getJobImage, getJobOutput, deleteJob } from '@/lib/meshJobs/jobs'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  await prisma.model3DJob.deleteMany()
})

const DEFAULT_GENERATION_PARAMS = {
  generateTexture: false,
  seed: null,
  octreeResolution: 384,
  textureResolution: 512,
  simplifyTarget: null,
} as const

function makeJobInput(overrides: Partial<Parameters<typeof createJob>[0]> = {}) {
  return { data: Buffer.from('img'), contentType: 'image/png', sizeBytes: 3, ...DEFAULT_GENERATION_PARAMS, ...overrides }
}

describe('meshJobs', () => {
  it('createJob cria com status PENDENTE', async () => {
    const job = await createJob(makeJobInput())
    expect(job.status).toBe('PENDENTE')
  })

  it('claimNextJob reivindica o job PENDENTE mais antigo e marca PROCESSANDO', async () => {
    const job = await createJob(makeJobInput())
    const claimed = await claimNextJob()
    expect(claimed?.id).toBe(job.id)
    expect(claimed?.status).toBe('PROCESSANDO')
  })

  it('claimNextJob devolve null quando não há job disponível', async () => {
    const claimed = await claimNextJob()
    expect(claimed).toBeNull()
  })

  it('claimNextJob reivindica um job PROCESSANDO abandonado há mais de 15min', async () => {
    const job = await createJob(makeJobInput())
    await prisma.model3DJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSANDO', claimedAt: new Date(Date.now() - 16 * 60 * 1000) },
    })
    const claimed = await claimNextJob()
    expect(claimed?.id).toBe(job.id)
  })

  it('claimNextJob NÃO reivindica um job PROCESSANDO há menos de 15min', async () => {
    const job = await createJob(makeJobInput())
    await prisma.model3DJob.update({ where: { id: job.id }, data: { status: 'PROCESSANDO', claimedAt: new Date() } })
    const claimed = await claimNextJob()
    expect(claimed).toBeNull()
  })

  it('completeJob grava os arquivos e marca CONCLUIDO', async () => {
    const job = await createJob(makeJobInput())
    await completeJob(job.id, Buffer.from('obj-data'), Buffer.from('stl-data'), Buffer.from('glb-data'))
    const obj = await getJobOutput(job.id, 'obj')
    const stl = await getJobOutput(job.id, 'stl')
    const glb = await getJobOutput(job.id, 'glb')
    expect(obj?.toString()).toBe('obj-data')
    expect(stl?.toString()).toBe('stl-data')
    expect(glb?.toString()).toBe('glb-data')
  })

  it('failJob marca ERRO com a mensagem', async () => {
    const job = await createJob(makeJobInput())
    await failJob(job.id, 'sem GPU disponível')
    const updated = await prisma.model3DJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(updated.status).toBe('ERRO')
    expect(updated.errorMessage).toBe('sem GPU disponível')
  })

  it('listRecentJobs devolve hasObj/hasStl/hasGlb corretos, createdAt como string ISO, sem devolver os bytes', async () => {
    const job = await createJob(makeJobInput())
    await completeJob(job.id, Buffer.from('obj-data'), Buffer.from('stl-data'), Buffer.from('glb-data'))
    const jobs = await listRecentJobs()
    const found = jobs.find((j) => j.id === job.id)
    expect(found?.hasObj).toBe(true)
    expect(found?.hasStl).toBe(true)
    expect(found?.hasGlb).toBe(true)
    expect(typeof found?.createdAt).toBe('string')
  })

  it('getJobImage devolve a imagem e o content type', async () => {
    const job = await createJob(makeJobInput({ data: Buffer.from('img-bytes'), contentType: 'image/jpeg', sizeBytes: 9 }))
    const image = await getJobImage(job.id)
    expect(image?.contentType).toBe('image/jpeg')
    expect(image?.data.toString()).toBe('img-bytes')
  })

  it('deleteJob remove o job', async () => {
    const job = await createJob(makeJobInput())
    await deleteJob(job.id)
    const found = await prisma.model3DJob.findUnique({ where: { id: job.id } })
    expect(found).toBeNull()
  })
})
