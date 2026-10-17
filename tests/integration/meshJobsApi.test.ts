import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { GET as nextHandler } from '@/app/api/mesh-jobs/next/route'
import { GET as imageHandler } from '@/app/api/mesh-jobs/[id]/image/route'
import { POST as completeHandler } from '@/app/api/mesh-jobs/[id]/complete/route'
import { POST as failHandler } from '@/app/api/mesh-jobs/[id]/fail/route'
import { GET as downloadHandler } from '@/app/api/mesh-jobs/[id]/download/[kind]/route'
import { createJob, saveJobOutputPart } from '@/lib/meshJobs/jobs'

// Helper de teste -- equivalente a completar o job via as 3 chamadas
// separadas que o worker de verdade faz (ver worker/mesh_worker.py).
async function completeJob(id: string, obj: Buffer, stl: Buffer, glb: Buffer) {
  await saveJobOutputPart(id, 'obj', obj)
  await saveJobOutputPart(id, 'stl', stl)
  await saveJobOutputPart(id, 'glb', glb)
}

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  process.env.MESH_WORKER_SECRET = 'segredo-teste'
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

function authedReq(url: string, init?: { method?: string; body?: BodyInit; headers?: HeadersInit }) {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', 'Bearer segredo-teste')
  return new NextRequest(url, { method: init?.method, body: init?.body, headers })
}

describe('GET /api/mesh-jobs/next', () => {
  it('rejeita sem o bearer token correto', async () => {
    const req = new NextRequest('https://x/api/mesh-jobs/next')
    const res = await nextHandler(req)
    expect(res.status).toBe(401)
  })

  it('devolve 204 quando não há job pendente', async () => {
    const res = await nextHandler(authedReq('https://x/api/mesh-jobs/next'))
    expect(res.status).toBe(204)
  })

  it('reivindica e devolve o id do job pendente mais antigo', async () => {
    const job = await createJob(makeJobInput())
    const res = await nextHandler(authedReq('https://x/api/mesh-jobs/next'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(job.id)
  })
})

describe('GET /api/mesh-jobs/:id/image', () => {
  it('devolve a imagem com o content type certo', async () => {
    const job = await createJob(makeJobInput({ data: Buffer.from('img-bytes'), contentType: 'image/jpeg', sizeBytes: 9 }))
    const res = await imageHandler(authedReq(`https://x/api/mesh-jobs/${job.id}/image`), { params: Promise.resolve({ id: job.id }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })

  it('devolve 404 pra job inexistente', async () => {
    const res = await imageHandler(authedReq('https://x/api/mesh-jobs/nao-existe/image'), { params: Promise.resolve({ id: 'nao-existe' }) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/mesh-jobs/:id/complete', () => {
  it('grava um arquivo por chamada e só marca CONCLUIDO depois dos 3', async () => {
    const job = await createJob(makeJobInput())
    for (const kind of ['obj', 'stl', 'glb'] as const) {
      const formData = new FormData()
      formData.set('kind', kind)
      formData.set('file', new File([Buffer.from(`${kind}-data`)], `mesh.${kind}`))
      const req = authedReq(`https://x/api/mesh-jobs/${job.id}/complete`, { method: 'POST', body: formData })
      const res = await completeHandler(req, { params: Promise.resolve({ id: job.id }) })
      expect(res.status).toBe(200)
      if (kind !== 'glb') {
        const midway = await prisma.model3DJob.findUniqueOrThrow({ where: { id: job.id } })
        expect(midway.status).not.toBe('CONCLUIDO')
      }
    }
    const updated = await prisma.model3DJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(updated.status).toBe('CONCLUIDO')
  })

  it('rejeita kind inválido', async () => {
    const job = await createJob(makeJobInput())
    const formData = new FormData()
    formData.set('kind', 'png')
    formData.set('file', new File([Buffer.from('x')], 'mesh.png'))
    const req = authedReq(`https://x/api/mesh-jobs/${job.id}/complete`, { method: 'POST', body: formData })
    const res = await completeHandler(req, { params: Promise.resolve({ id: job.id }) })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/mesh-jobs/:id/fail', () => {
  it('marca ERRO com a mensagem enviada', async () => {
    const job = await createJob(makeJobInput())
    const req = authedReq(`https://x/api/mesh-jobs/${job.id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ message: 'sem GPU disponível' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await failHandler(req, { params: Promise.resolve({ id: job.id }) })
    expect(res.status).toBe(200)
    const updated = await prisma.model3DJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(updated.status).toBe('ERRO')
    expect(updated.errorMessage).toBe('sem GPU disponível')
  })
})

describe('GET /api/mesh-jobs/:id/download/:kind', () => {
  it('devolve o STL concluído sem exigir bearer token (rota do navegador)', async () => {
    const job = await createJob(makeJobInput())
    await completeJob(job.id, Buffer.from('obj-data'), Buffer.from('stl-data'), Buffer.from('glb-data'))
    const req = new NextRequest(`https://x/api/mesh-jobs/${job.id}/download/stl`)
    const res = await downloadHandler(req, { params: Promise.resolve({ id: job.id, kind: 'stl' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('model/stl')
  })

  it('devolve 400 pra kind inválido', async () => {
    const req = new NextRequest('https://x/api/mesh-jobs/abc/download/png')
    const res = await downloadHandler(req, { params: Promise.resolve({ id: 'abc', kind: 'png' }) })
    expect(res.status).toBe(400)
  })
})
