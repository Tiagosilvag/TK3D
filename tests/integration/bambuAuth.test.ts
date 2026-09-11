import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { connectBambuAccountStep1, connectBambuAccountStep2, disconnectBambuAccount } from '@/actions/bambuAuth'
import * as auth from '@/lib/bambu/auth'

// restartBambuListener tentaria abrir uma conexão MQTT real com a nuvem
// Bambu -- mockado aqui porque isso não é o que este teste verifica (é
// coberto por tests/unit/bambuListener.test.ts).
vi.mock('@/lib/bambu/listener', () => ({ restartBambuListener: vi.fn() }))

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe('bambuAuth actions', () => {
  beforeEach(async () => {
    process.env.BAMBU_CREDENTIAL_KEY = 'a'.repeat(64)
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } as never })
    vi.spyOn(auth, 'fetchUserId').mockResolvedValue('999888777')
  })

  it('step1 sinaliza needsCode e não grava nada no banco quando a Bambu pede verificação (senha nunca persiste)', async () => {
    vi.spyOn(auth, 'requestLoginCode').mockResolvedValue({ status: 'code_required' })
    const result = await connectBambuAccountStep1(fd({ email: 'a@b.com', password: 'secreta' }))
    expect(result.success).toBe(true)
    expect(result.needsCode).toBe(true)
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudCredentialEncrypted).toBeNull()
  })

  it('step1 já grava a credencial quando a conta não exige verificação extra', async () => {
    vi.spyOn(auth, 'requestLoginCode').mockResolvedValue({ status: 'authenticated', accessToken: 'token-direct' })
    const result = await connectBambuAccountStep1(fd({ email: 'a@b.com', password: 'secreta' }))
    expect(result.success).toBe(true)
    expect(result.needsCode).toBe(false)
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudEmail).toBe('a@b.com')
    expect(settings?.bambuCloudUserId).toBe('999888777')
    expect(settings?.bambuCloudCredentialEncrypted).not.toBeNull()
  })

  it('step2 grava a credencial cifrada e o uid em Settings', async () => {
    vi.spyOn(auth, 'confirmLoginCode').mockResolvedValue({ accessToken: 'token-abc' })
    const result = await connectBambuAccountStep2(fd({ code: '000000', email: 'a@b.com' }))
    expect(result.success).toBe(true)
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudEmail).toBe('a@b.com')
    expect(settings?.bambuCloudUserId).toBe('999888777')
    expect(settings?.bambuCloudCredentialEncrypted).not.toBeNull()
    expect(settings?.bambuCloudCredentialEncrypted).not.toContain('token-abc')
  })

  it('disconnectBambuAccount limpa a credencial', async () => {
    await disconnectBambuAccount()
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudCredentialEncrypted).toBeNull()
    expect(settings?.bambuCloudEmail).toBeNull()
    expect(settings?.bambuCloudUserId).toBeNull()
  })
})
