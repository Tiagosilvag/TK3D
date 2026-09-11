import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestLoginCode, confirmLoginCode } from '@/lib/bambu/auth'

describe('bambu auth client', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('requestLoginCode devolve o ticket retornado pela Bambu', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: null, loginType: 'verifyCode', tmpToken: 'ticket-123' }),
    }) as unknown as typeof fetch

    const result = await requestLoginCode('user@example.com', 'senha')
    expect(result.ticket).toBe('ticket-123')
  })

  it('requestLoginCode lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as unknown as typeof fetch
    await expect(requestLoginCode('user@example.com', 'errada')).rejects.toThrow('Falha ao solicitar código de login da Bambu')
  })

  it('confirmLoginCode devolve o accessToken', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'token-abc' }) }) as unknown as typeof fetch
    const result = await confirmLoginCode('ticket-123', '000000')
    expect(result.accessToken).toBe('token-abc')
  })

  it('confirmLoginCode lança erro se a Bambu não devolver accessToken', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
    await expect(confirmLoginCode('ticket-123', '000000')).rejects.toThrow('Código inválido ou expirado')
  })
})
