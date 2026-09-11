import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestLoginCode, confirmLoginCode } from '@/lib/bambu/auth'

describe('bambu auth client', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('requestLoginCode dispara o e-mail e sinaliza code_required quando a Bambu pede verificação', async () => {
    const fetchMock = vi
      .fn()
      // 1ª chamada: login com senha -> pede verificação
      .mockResolvedValueOnce({ ok: true, json: async () => ({ loginType: 'verifyCode' }) })
      // 2ª chamada: dispara o código por e-mail
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await requestLoginCode('user@example.com', 'senha')
    expect(result).toEqual({ status: 'code_required' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('requestLoginCode devolve authenticated direto quando a conta não exige verificação extra', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'token-direct' }) }) as unknown as typeof fetch
    const result = await requestLoginCode('user@example.com', 'senha')
    expect(result).toEqual({ status: 'authenticated', accessToken: 'token-direct' })
  })

  it('requestLoginCode lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as unknown as typeof fetch
    await expect(requestLoginCode('user@example.com', 'errada')).rejects.toThrow('Falha ao solicitar código de login da Bambu')
  })

  it('requestLoginCode lança erro quando a Bambu recusa sem pedir verificação (senha errada)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
    await expect(requestLoginCode('user@example.com', 'errada')).rejects.toThrow('Bambu recusou o login')
  })

  it('confirmLoginCode devolve o accessToken', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'token-abc' }) }) as unknown as typeof fetch
    const result = await confirmLoginCode('user@example.com', '000000')
    expect(result.accessToken).toBe('token-abc')
  })

  it('confirmLoginCode lança erro se a Bambu não devolver accessToken', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
    await expect(confirmLoginCode('user@example.com', '000000')).rejects.toThrow('Código inválido ou expirado')
  })
})
