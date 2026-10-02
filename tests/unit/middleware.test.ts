import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

// Finding 1 (revisão final da integração Mercado Livre): o POST do
// webhook do ML (e de qualquer /api/webhooks/* futuro) nunca carrega o
// cookie `session` -- sem a isenção em middleware.ts, toda entrega virava
// um redirect 307 pro /login e o route handler nunca rodava. Estes testes
// provam o contrato: uma requisição SEM sessão a um path de webhook passa
// direto (NextResponse.next(), sem redirect), enquanto o resto do app
// continua exigindo sessão válida como antes.
describe('middleware', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret'
  })

  it('deixa passar POST sem cookie de sessão em /api/webhooks/mercado-livre (não redireciona)', () => {
    const req = new NextRequest('https://tk3d.coffetech.com.br/api/webhooks/mercado-livre', { method: 'POST' })
    const res = middleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('deixa passar qualquer path sob /api/webhooks/ sem sessão (prefixo cobre futuros webhooks)', () => {
    const req = new NextRequest('https://tk3d.coffetech.com.br/api/webhooks/shopee', { method: 'POST' })
    const res = middleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('continua redirecionando pra /login uma rota comum sem sessão válida', () => {
    const req = new NextRequest('https://tk3d.coffetech.com.br/orders', { method: 'GET' })
    const res = middleware(req)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('deixa passar uma rota comum quando a sessão é válida', async () => {
    const { signSession } = await import('@/lib/auth')
    const token = signSession()
    const req = new NextRequest('https://tk3d.coffetech.com.br/orders', {
      method: 'GET',
      headers: { cookie: `session=${token}` },
    })
    const res = middleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })
})
