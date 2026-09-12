import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestLoginCode, confirmLoginCode, fetchUserId, fetchBoundDevices, fetchTaskHistory, fetchLatestTask } from '@/lib/bambu/auth'

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

  it('fetchUserId devolve o uid como string, enviando o Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uid: 1234567890 }) })
    global.fetch = fetchMock as unknown as typeof fetch
    const uid = await fetchUserId('token-abc')
    expect(uid).toBe('1234567890')
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { headers: { Authorization: 'Bearer token-abc' } })
  })

  it('fetchUserId lança erro se a Bambu não devolver uid', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
    await expect(fetchUserId('token-abc')).rejects.toThrow('Bambu não retornou o id da conta')
  })

  it('fetchBoundDevices mapeia dev_id/dev_product_name pros campos usados no app', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        devices: [
          { dev_id: '01P00A000000000', name: 'A1 mini', dev_product_name: 'A1 mini', online: true },
          { dev_id: '', name: 'sem id', dev_product_name: 'X', online: false }, // sem dev_id -- descartado
        ],
      }),
    }) as unknown as typeof fetch
    const devices = await fetchBoundDevices('token-abc')
    expect(devices).toEqual([{ devId: '01P00A000000000', name: 'A1 mini', productName: 'A1 mini', online: true }])
  })

  it('fetchBoundDevices devolve lista vazia quando a conta não tem impressora vinculada', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ devices: [] }) }) as unknown as typeof fetch
    expect(await fetchBoundDevices('token-abc')).toEqual([])
  })

  it('fetchBoundDevices lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    await expect(fetchBoundDevices('token-abc')).rejects.toThrow('Falha ao buscar impressoras da conta Bambu')
  })

  it('fetchTaskHistory mapeia os campos de cada task (formato hits array direto)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: [
          {
            id: 't1',
            designTitle: 'Vaso',
            deviceName: 'A1 mini',
            status: 'completed',
            weight: '12.5',
            length: '1850.2',
            costTime: '3600',
            startTime: '2026-09-01T10:00:00Z',
            endTime: '2026-09-01T11:00:00Z',
            cover: 'https://example.com/cover.jpg',
          },
        ],
      }),
    }) as unknown as typeof fetch
    const result = await fetchTaskHistory('token-abc', { limit: 20 })
    expect(result.tasks).toEqual([
      {
        id: 't1',
        title: 'Vaso',
        deviceName: 'A1 mini',
        status: 'completed',
        weightGrams: 12.5,
        lengthM: 1850.2,
        costTimeSeconds: 3600,
        startTime: '2026-09-01T10:00:00Z',
        endTime: '2026-09-01T11:00:00Z',
        thumbnailUrl: 'https://example.com/cover.jpg',
      },
    ])
    expect(result.nextCursor).toBeNull() // menos itens que o limite -- não tem próxima página
  })

  it('fetchTaskHistory também entende o formato aninhado estilo Elasticsearch (hits.hits)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: { hits: [{ id: 't1', status: 'completed' }] } }),
    }) as unknown as typeof fetch
    const result = await fetchTaskHistory('token-abc')
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].id).toBe('t1')
  })

  it('fetchTaskHistory usa o id da última task como cursor quando a página vem cheia', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'completed' }] }),
    }) as unknown as typeof fetch
    const result = await fetchTaskHistory('token-abc', { limit: 2 })
    expect(result.nextCursor).toBe('t2')
  })

  it('fetchTaskHistory lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    await expect(fetchTaskHistory('token-abc')).rejects.toThrow('Falha ao buscar histórico de impressões da Bambu')
  })

  it('fetchLatestTask devolve null quando não há nenhuma task', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hits: [] }) }) as unknown as typeof fetch
    expect(await fetchLatestTask('token-abc', 'dev-1')).toBeNull()
  })

  it('fetchLatestTask devolve a primeira task encontrada', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: [{ id: 't1', status: 'completed', weight: '20' }] }),
    }) as unknown as typeof fetch
    const task = await fetchLatestTask('token-abc', 'dev-1')
    expect(task).toEqual({ weightGrams: 20, thumbnailUrl: null, status: 'completed' })
  })
})
