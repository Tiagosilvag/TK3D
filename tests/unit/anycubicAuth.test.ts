import { describe, it, expect, vi, afterEach } from 'vitest'
import { exchangeSlicerToken, fetchUserInfo, fetchMyPrinters } from '@/lib/anycubic/auth'

describe('anycubic auth client', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('exchangeSlicerToken troca o token colado por um auth_token de sessão', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { token: 'session-token-abc' } }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await exchangeSlicerToken('slicer-token-xyz')
    expect(result).toEqual({ authToken: 'session-token-abc' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/v3/public/loginWithAccessToken')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ device_type: 'pcf', access_token: 'slicer-token-xyz' })
  })

  it('exchangeSlicerToken remove espaços/quebras de linha internas (bug real: copiar do console do PowerShell quebra o JWT em várias linhas)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { token: 'session-token-abc' } }) })
    global.fetch = fetchMock as unknown as typeof fetch

    await exchangeSlicerToken('  eyJhbGci.\n  parte-do-meio  \r\n.assinatura  ')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.access_token).toBe('eyJhbGci.parte-do-meio.assinatura')
  })

  it('exchangeSlicerToken lança erro se a resposta não tiver data.token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ msg: 'invalid token' }) }) as unknown as typeof fetch
    await expect(exchangeSlicerToken('token-invalido')).rejects.toThrow('Token do Slicer Next inválido ou expirado')
  })

  it('exchangeSlicerToken lança erro em resposta HTTP não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch
    await expect(exchangeSlicerToken('token')).rejects.toThrow('Falha ao trocar o token do Slicer Next')
  })

  it('fetchUserInfo devolve id e email, enviando XX-Token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 42, user_email: 'user@example.com' } }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const info = await fetchUserInfo('session-token-abc')
    expect(info).toEqual({ id: '42', email: 'user@example.com' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['XX-Token']).toBe('session-token-abc')
  })

  it('fetchMyPrinters lista as impressoras com key e nome', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ key: 'abc123', name: 'Kobra 3' }, { key: 'def456', name: 'Kobra 2' }] }),
    }) as unknown as typeof fetch

    const printers = await fetchMyPrinters('session-token-abc')
    expect(printers).toEqual([{ key: 'abc123', name: 'Kobra 3' }, { key: 'def456', name: 'Kobra 2' }])
  })

  it('fetchMyPrinters ignora entradas sem key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ name: 'Sem key' }, { key: 'def456', name: 'Kobra 2' }] }),
    }) as unknown as typeof fetch

    const printers = await fetchMyPrinters('session-token-abc')
    expect(printers).toEqual([{ key: 'def456', name: 'Kobra 2' }])
  })
})
