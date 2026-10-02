import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildAuthorizationUrl, exchangeCodeForTokens, refreshAccessToken, isTokenExpiringSoon } from '@/lib/mercadoLivre/auth'

describe('mercadoLivre auth client', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('buildAuthorizationUrl monta a URL com client_id e redirect_uri do ambiente', () => {
    process.env.MERCADOLIVRE_CLIENT_ID = 'client-123'
    process.env.MERCADOLIVRE_REDIRECT_URI = 'https://tk3d.coffetech.com.br/api/integrations/mercado-livre/callback'
    const url = buildAuthorizationUrl()
    expect(url).toContain('https://auth.mercadolivre.com.br/authorization')
    expect(url).toContain('response_type=code')
    expect(url).toContain('client_id=client-123')
    expect(url).toContain(encodeURIComponent('https://tk3d.coffetech.com.br/api/integrations/mercado-livre/callback'))
  })

  it('exchangeCodeForTokens troca o código pelos tokens', async () => {
    process.env.MERCADOLIVRE_CLIENT_ID = 'client-123'
    process.env.MERCADOLIVRE_CLIENT_SECRET = 'secret-abc'
    process.env.MERCADOLIVRE_REDIRECT_URI = 'https://tk3d.coffetech.com.br/api/integrations/mercado-livre/callback'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 21600, user_id: 999 }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await exchangeCodeForTokens('code-xyz')

    expect(result).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 21600, userId: '999' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('exchangeCodeForTokens lança erro com resposta não-ok', async () => {
    process.env.MERCADOLIVRE_CLIENT_ID = 'client-123'
    process.env.MERCADOLIVRE_CLIENT_SECRET = 'secret-abc'
    process.env.MERCADOLIVRE_REDIRECT_URI = 'https://tk3d.coffetech.com.br/api/integrations/mercado-livre/callback'
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'invalid_grant' }) }) as unknown as typeof fetch
    await expect(exchangeCodeForTokens('code-invalido')).rejects.toThrow('Falha ao trocar código pelo token do Mercado Livre')
  })

  it('refreshAccessToken renova usando o refresh token', async () => {
    process.env.MERCADOLIVRE_CLIENT_ID = 'client-123'
    process.env.MERCADOLIVRE_CLIENT_SECRET = 'secret-abc'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 21600, user_id: 999 }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await refreshAccessToken('refresh-1')
    expect(result.accessToken).toBe('access-2')
  })

  it('refreshAccessToken lança erro com resposta não-ok', async () => {
    process.env.MERCADOLIVRE_CLIENT_ID = 'client-123'
    process.env.MERCADOLIVRE_CLIENT_SECRET = 'secret-abc'
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }) as unknown as typeof fetch
    await expect(refreshAccessToken('refresh-expirado')).rejects.toThrow('Falha ao renovar token do Mercado Livre')
  })

  it('isTokenExpiringSoon é true quando faltam menos de 5 minutos', () => {
    const daquiA4min = new Date(Date.now() + 4 * 60 * 1000)
    expect(isTokenExpiringSoon(daquiA4min)).toBe(true)
  })

  it('isTokenExpiringSoon é false quando falta mais de 5 minutos', () => {
    const daquiA10min = new Date(Date.now() + 10 * 60 * 1000)
    expect(isTokenExpiringSoon(daquiA10min)).toBe(false)
  })

  it('isTokenExpiringSoon é true quando já expirou', () => {
    const jaExpirou = new Date(Date.now() - 1000)
    expect(isTokenExpiringSoon(jaExpirou)).toBe(true)
  })
})
