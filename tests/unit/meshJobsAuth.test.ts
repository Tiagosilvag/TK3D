import { describe, it, expect, afterEach } from 'vitest'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'

describe('verifyWorkerAuth', () => {
  const originalSecret = process.env.MESH_WORKER_SECRET

  afterEach(() => {
    process.env.MESH_WORKER_SECRET = originalSecret
  })

  it('aceita o header Authorization correto', () => {
    process.env.MESH_WORKER_SECRET = 'segredo-123'
    const req = new Request('https://x/test', { headers: { Authorization: 'Bearer segredo-123' } })
    expect(verifyWorkerAuth(req)).toBe(true)
  })

  it('rejeita um secret errado', () => {
    process.env.MESH_WORKER_SECRET = 'segredo-123'
    const req = new Request('https://x/test', { headers: { Authorization: 'Bearer errado' } })
    expect(verifyWorkerAuth(req)).toBe(false)
  })

  it('rejeita quando não há header Authorization', () => {
    process.env.MESH_WORKER_SECRET = 'segredo-123'
    const req = new Request('https://x/test')
    expect(verifyWorkerAuth(req)).toBe(false)
  })

  it('rejeita (nunca lança) quando MESH_WORKER_SECRET não está configurada', () => {
    delete process.env.MESH_WORKER_SECRET
    const req = new Request('https://x/test', { headers: { Authorization: 'Bearer qualquer' } })
    expect(verifyWorkerAuth(req)).toBe(false)
  })
})
