import { describe, it, expect, vi, afterEach } from 'vitest'
import { exchangeSlicerToken, fetchUserInfo, fetchMyPrinters, fetchProjectInfo } from '@/lib/anycubic/auth'

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

  it('fetchProjectInfo monta a thumbnail a partir do image_id (bucket S3 público da Anycubic)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { image_id: 'proj/abc123.png', slice_param: {} } }),
    }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info.thumbnailUrl).toBe('https://workbentch.s3.us-east-2.amazonaws.com/proj/abc123.png')

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain('/v2/project/info?id=12345')
  })

  it('fetchProjectInfo extrai o consumo por cor de slice_param.paint_infos (filament_used em gramas)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          slice_param: {
            paint_infos: [
              { material_type: 'PLA', color: '#dc2626', filament_used: 36.1 },
              { material_type: 'PLA', color: '#111827', filament_used: 136.7 },
            ],
          },
        },
      }),
    }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info.materialBreakdown).toEqual([
      { materialType: 'PLA', colorHex: '#dc2626', grams: 36.1 },
      { materialType: 'PLA', colorHex: '#111827', grams: 136.7 },
    ])
  })

  it('fetchProjectInfo extrai as dimensões do modelo quando slice_param tem x/y/z_size', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { slice_param: { x_size: 216, y_size: 191, z_size: 27 } } }),
    }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info.modelDimensions).toBe('216 x 191 x 27 mm')
  })

  it('fetchProjectInfo aceita slice_param como string JSON (formato alternativo visto no código de referência)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { slice_param: JSON.stringify({ x_size: 100, y_size: 100, z_size: 50 }) } }),
    }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info.modelDimensions).toBe('100 x 100 x 50 mm')
  })

  it('fetchProjectInfo devolve tudo null quando a resposta não tem os campos esperados, sem lançar erro', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info).toEqual({ thumbnailUrl: null, materialBreakdown: null, modelDimensions: null })
  })

  it('fetchProjectInfo lança erro em resposta HTTP não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch
    await expect(fetchProjectInfo('session-token-abc', 12345)).rejects.toThrow('Falha ao buscar informações do job')
  })
})
