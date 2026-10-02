import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { POST } from '@/app/api/webhooks/mercado-livre/route'
import { saveConnection } from '@/lib/mercadoLivre/connection'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  // Finding 6 (revisão final): mesmo defeito de setup que o fix do Task 3
  // já corrigiu em mercadoLivreConnection.test.ts -- saveConnection cifra
  // os tokens (lib/crypto.ts) e precisa de BAMBU_CREDENTIAL_KEY no
  // ambiente; sem isso, este teste falharia contra um banco real.
  process.env.BAMBU_CREDENTIAL_KEY = 'a'.repeat(64)
  await prisma.notification.deleteMany()
  await prisma.marketplaceOrderInbox.deleteMany()
  await prisma.marketplaceConnection.deleteMany()
  await saveConnection({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresIn: 21600, userId: '999' })
})
afterEach(() => {
  vi.restoreAllMocks()
})

function makeRequest(body: unknown): Request {
  return new Request('https://tk3d.coffetech.com.br/api/webhooks/mercado-livre', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('webhook do Mercado Livre', () => {
  it('ignora tópico que não é orders_v2 (200 OK, sem processar)', async () => {
    const response = await POST(makeRequest({ topic: 'questions', resource: '/questions/1' }) as never)
    expect(response.status).toBe(200)
    expect(await prisma.marketplaceOrderInbox.count()).toBe(0)
  })

  it('processa orders_v2 e cria o inbox', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 777, total_amount: 50, order_items: [] }),
    }) as unknown as typeof fetch

    const response = await POST(makeRequest({ topic: 'orders_v2', resource: '/orders/777' }) as never)
    expect(response.status).toBe(200)
    const inbox = await prisma.marketplaceOrderInbox.findFirst()
    expect(inbox?.externalOrderId).toBe('777')
  })

  it('devolve 200 mesmo se processOrderNotification falhar (nunca derruba, ML reenviaria em loop com erro)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch
    const response = await POST(makeRequest({ topic: 'orders_v2', resource: '/orders/888' }) as never)
    expect(response.status).toBe(200)
  })

  it('devolve 200 com corpo malformado (JSON inválido)', async () => {
    const response = await POST(
      new Request('https://tk3d.coffetech.com.br/api/webhooks/mercado-livre', { method: 'POST', body: 'não é json' }) as never
    )
    expect(response.status).toBe(200)
  })

  it('devolve 200 com corpo null (JSON válido mas payload inválido)', async () => {
    const response = await POST(makeRequest(null) as never)
    expect(response.status).toBe(200)
    expect(await prisma.marketplaceOrderInbox.count()).toBe(0)
  })

  it('devolve 200 quando resource não é string (JSON válido mas tipo inválido)', async () => {
    const response = await POST(makeRequest({ topic: 'orders_v2', resource: 123 }) as never)
    expect(response.status).toBe(200)
    expect(await prisma.marketplaceOrderInbox.count()).toBe(0)
  })

  it('devolve 200 quando topic não é string (JSON válido mas tipo inválido)', async () => {
    const response = await POST(makeRequest({ topic: ['orders_v2'], resource: '/orders/555' }) as never)
    expect(response.status).toBe(200)
    expect(await prisma.marketplaceOrderInbox.count()).toBe(0)
  })
})
