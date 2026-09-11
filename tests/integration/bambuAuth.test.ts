import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { connectBambuAccountStep1, connectBambuAccountStep2, disconnectBambuAccount } from '@/actions/bambuAuth'
import * as auth from '@/lib/bambu/auth'

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

describe('bambuAuth actions', () => {
  beforeEach(async () => {
    process.env.BAMBU_CREDENTIAL_KEY = 'a'.repeat(64)
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } as never })
  })

  it('step1 devolve o ticket e não grava nada no banco (senha nunca persiste)', async () => {
    vi.spyOn(auth, 'requestLoginCode').mockResolvedValue({ ticket: 'ticket-xyz' })
    const result = await connectBambuAccountStep1(fd({ email: 'a@b.com', password: 'secreta' }))
    expect(result.success).toBe(true)
    expect(result.ticket).toBe('ticket-xyz')
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudCredentialEncrypted).toBeNull()
  })

  it('step2 grava a credencial cifrada em Settings', async () => {
    vi.spyOn(auth, 'confirmLoginCode').mockResolvedValue({ accessToken: 'token-abc' })
    const result = await connectBambuAccountStep2(fd({ ticket: 'ticket-xyz', code: '000000', email: 'a@b.com' }))
    expect(result.success).toBe(true)
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudEmail).toBe('a@b.com')
    expect(settings?.bambuCloudCredentialEncrypted).not.toBeNull()
    expect(settings?.bambuCloudCredentialEncrypted).not.toContain('token-abc')
  })

  it('disconnectBambuAccount limpa a credencial', async () => {
    await disconnectBambuAccount()
    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(settings?.bambuCloudCredentialEncrypted).toBeNull()
    expect(settings?.bambuCloudEmail).toBeNull()
  })
})
