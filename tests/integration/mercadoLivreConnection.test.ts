import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getValidAccessToken, saveConnection } from '@/lib/mercadoLivre/connection'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeEach(async () => {
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
})
