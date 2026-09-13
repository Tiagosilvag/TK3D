import { describe, it, expect, vi, afterEach } from 'vitest'
import { exchangeSlicerToken, fetchUserInfo, fetchMyPrinters, fetchProjectInfo, fetchProjectHistory } from '@/lib/anycubic/auth'

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

  it('fetchProjectInfo extrai o consumo por cor de slice_param.paint_infos, convertendo paint_color [r,g,b] pra hex (confirmado contra resposta real)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          slice_param: {
            paint_infos: [
              { material_type: 'PLA', paint_color: [255, 0, 0], filament_used: 36.11 },
              { material_type: 'PLA', paint_color: [255, 255, 255], filament_used: 29.45 },
              { material_type: 'PLA', paint_color: [0, 0, 0], filament_used: 136.65 },
            ],
          },
        },
      }),
    }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info.materialBreakdown).toEqual([
      { materialType: 'PLA', colorHex: '#ff0000', grams: 36.11 },
      { materialType: 'PLA', colorHex: '#ffffff', grams: 29.45 },
      { materialType: 'PLA', colorHex: '#000000', grams: 136.65 },
    ])
  })

  it('fetchProjectInfo aceita cor como string hex também (formato alternativo, defensivo)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { slice_param: { paint_infos: [{ material_type: 'PLA', color: '#dc2626', filament_used: 36.1 }] } },
      }),
    }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info.materialBreakdown).toEqual([{ materialType: 'PLA', colorHex: '#dc2626', grams: 36.1 }])
  })

  it('fetchProjectInfo extrai as dimensões do modelo de slice_result.size_x/y/z (confirmado contra resposta real -- não fica dentro de slice_param)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { slice_result: { size_x: 216.2, size_y: 191.78, size_z: 27.4 } } }),
    }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info.modelDimensions).toBe('216.2 x 191.78 x 27.4 mm')
  })

  it('fetchProjectInfo devolve tudo null quando a resposta não tem os campos esperados, sem lançar erro', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info).toEqual({ thumbnailUrl: null, materialBreakdown: null, modelDimensions: null, printSpeedModeLabels: null })
  })

  it('fetchProjectInfo lança erro em resposta HTTP não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch
    await expect(fetchProjectInfo('session-token-abc', 12345)).rejects.toThrow('Falha ao buscar informações do job')
  })

  it('fetchProjectInfo extrai os nomes dos modos de velocidade de print_speed_model_des (confirmado contra resposta real)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          print_speed_model_des: [
            { print_speed_mode: 1, title: 'Quiet' },
            { print_speed_mode: 2, title: 'Standard' },
            { print_speed_mode: 3, title: 'Sport' },
          ],
        },
      }),
    }) as unknown as typeof fetch

    const info = await fetchProjectInfo('session-token-abc', 12345)
    expect(info.printSpeedModeLabels).toEqual({ 1: 'Quiet', 2: 'Standard', 3: 'Sport' })
  })

  it('fetchProjectHistory mapeia os registros da lista de projetos (nome, impressora, status, tempos)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 111,
            gcode_name: 'peca.gcode',
            printer_name: 'Kobra X',
            print_status: 2,
            create_time: 1700000000,
            start_time: 1700000100,
            end_time: 1700003700,
            print_time: 60,
            img: 'proj/111.png',
            slice_param: { paint_infos: [{ material_type: 'PLA', color: '#dc2626', filament_used: 10 }] },
          },
        ],
      }),
    }) as unknown as typeof fetch

    const { tasks } = await fetchProjectHistory('session-token-abc')
    expect(tasks).toEqual([
      {
        id: '111',
        gcodeName: 'peca.gcode',
        printerName: 'Kobra X',
        printStatus: 2,
        createTime: 1700000000,
        startTime: 1700000100,
        endTime: 1700003700,
        printTimeMinutes: 60,
        thumbnailUrl: 'https://workbentch.s3.us-east-2.amazonaws.com/proj/111.png',
        materialBreakdown: [{ materialType: 'PLA', colorHex: '#dc2626', grams: 10 }],
        modelDimensions: null,
        printSpeedModeLabels: null,
      },
    ])

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain('/work/project/getProjects?page=1')
  })

  it('fetchProjectHistory usa a página pedida e sinaliza hasMore quando a página vem cheia', async () => {
    const twentyRecords = Array.from({ length: 20 }, (_, i) => ({ id: i, gcode_name: `f${i}.gcode` }))
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: twentyRecords }) }) as unknown as typeof fetch

    const result = await fetchProjectHistory('session-token-abc', { page: 2 })
    expect(result.hasMore).toBe(true)
    expect(result.tasks).toHaveLength(20)

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain('page=2')
  })

  it('fetchProjectHistory sinaliza hasMore=false quando a página vem incompleta', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 1, gcode_name: 'unico.gcode' }] }),
    }) as unknown as typeof fetch

    const result = await fetchProjectHistory('session-token-abc')
    expect(result.hasMore).toBe(false)
  })

  it('fetchProjectHistory lança erro em resposta HTTP não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch
    await expect(fetchProjectHistory('session-token-abc')).rejects.toThrow('Falha ao buscar histórico')
  })
})
