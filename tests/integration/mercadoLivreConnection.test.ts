import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getValidAccessToken, saveConnection } from '@/lib/mercadoLivre/connection'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
  process.env.BAMBU_CREDENTIAL_KEY = 'a'.repeat(64)
  // Finding 6 (revisão final): refreshAccessToken (lib/mercadoLivre/auth.ts)
  // lê MERCADOLIVRE_CLIENT_ID/CLIENT_SECRET antes de sequer montar o fetch
  // -- sem essas vars, os testes abaixo que dependem de um refresh de
  // verdade acontecer (e do fetch mockado ser chamado) nunca chegavam lá:
  // o erro lançado por getClientId()/getClientSecret() nem tem `.status`
  // (não é um MLRefreshError), então com o fix do Finding 3a ele seria
  // RELANÇADO como falha transitória em vez de marcar DESCONECTADA --
  // mascarando o que o teste "renova e salva"/"marca DESCONECTADA" dizem
  // testar.
  process.env.MERCADOLIVRE_CLIENT_ID = 'client-teste'
  process.env.MERCADOLIVRE_CLIENT_SECRET = 'secret-teste'
  await prisma.marketplaceConnection.deleteMany()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('mercadoLivre connection', () => {
  it('getValidAccessToken devolve o token decifrado quando não está perto de expirar', async () => {
    await saveConnection({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresIn: 21600, userId: '999' })
    const token = await getValidAccessToken()
    expect(token).toBe('tok-1')
  })

  it('getValidAccessToken renova e salva quando o token está prestes a expirar', async () => {
    await saveConnection({ accessToken: 'tok-velho', refreshToken: 'ref-1', expiresIn: 60, userId: '999' })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-novo', refresh_token: 'ref-2', expires_in: 21600, user_id: 999 }),
    }) as unknown as typeof fetch

    const token = await getValidAccessToken()
    expect(token).toBe('tok-novo')
    const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
    expect(connection?.status).toBe('CONECTADA')
  })

  it('getValidAccessToken marca DESCONECTADA quando o refresh falha', async () => {
    await saveConnection({ accessToken: 'tok-velho', refreshToken: 'ref-invalido', expiresIn: 60, userId: '999' })
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }) as unknown as typeof fetch

    await expect(getValidAccessToken()).rejects.toThrow('Conexão com o Mercado Livre expirou')
    const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
    expect(connection?.status).toBe('DESCONECTADA')
  })

  it('getValidAccessToken lança erro quando nunca foi conectado', async () => {
    await expect(getValidAccessToken()).rejects.toThrow('Mercado Livre não está conectado')
  })

  // Finding 3a (revisão final): uma falha TRANSITÓRIA no refresh (5xx, erro
  // de rede, etc.) nunca deve marcar DESCONECTADA -- só um refresh token
  // REALMENTE revogado/expirado (400/401) deveria exigir reconexão manual.
  it('getValidAccessToken NÃO marca DESCONECTADA e relança quando o refresh falha com 500 (falha transitória)', async () => {
    await saveConnection({ accessToken: 'tok-velho', refreshToken: 'ref-1', expiresIn: 60, userId: '999' })
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch

    await expect(getValidAccessToken()).rejects.toThrow('Falha ao renovar token do Mercado Livre')
    const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
    expect(connection?.status).toBe('CONECTADA')
  })

  it('getValidAccessToken NÃO marca DESCONECTADA e relança quando o refresh falha com erro de rede (sem status)', async () => {
    await saveConnection({ accessToken: 'tok-velho', refreshToken: 'ref-1', expiresIn: 60, userId: '999' })
    global.fetch = vi.fn().mockRejectedValue(new Error('network timeout')) as unknown as typeof fetch

    await expect(getValidAccessToken()).rejects.toThrow('network timeout')
    const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
    expect(connection?.status).toBe('CONECTADA')
  })

  // Finding 3b: refresh token do ML é de uso único -- duas chamadas
  // concorrentes vendo o mesmo token prestes a expirar devem compartilhar
  // UM SÓ refresh de verdade (1 chamada a fetch), nunca duas (a segunda,
  // com o refresh token já consumido pela primeira, falharia e marcaria
  // DESCONECTADA por cima de uma conexão recém-renovada com sucesso).
  it('getValidAccessToken: duas chamadas concorrentes quando o token está expirando só disparam UM refresh real', async () => {
    await saveConnection({ accessToken: 'tok-velho', refreshToken: 'ref-1', expiresIn: 60, userId: '999' })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok-novo', refresh_token: 'ref-2', expires_in: 21600, user_id: 999 }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const [tokenA, tokenB] = await Promise.all([getValidAccessToken(), getValidAccessToken()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(tokenA).toBe('tok-novo')
    expect(tokenB).toBe('tok-novo')
    const connection = await prisma.marketplaceConnection.findUnique({ where: { platform: 'MERCADO_LIVRE' } })
    expect(connection?.status).toBe('CONECTADA')
  })
})
