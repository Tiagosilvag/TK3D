import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'crypto'
import { signSession, verifySession } from '@/lib/auth'

describe('session token', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret'
  })

  it('assina e verifica um token válido', () => {
    const token = signSession()
    expect(verifySession(token)).toBe(true)
  })

  it('rejeita token adulterado', () => {
    const token = signSession()
    expect(verifySession(token + 'x')).toBe(false)
  })

  it('rejeita string vazia', () => {
    expect(verifySession('')).toBe(false)
  })

  it('rejeita um token cujo timestamp está além dos 30 dias de validade, mesmo com HMAC válido', () => {
    // Forge a token dated 31 days in the past, re-signed with the correct
    // secret — this proves verifySession checks the payload's age, not just
    // the HMAC (a valid signature over stale data must still be rejected).
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000
    const payload = String(thirtyOneDaysAgo)
    const hmac = crypto.createHmac('sha256', 'test-secret').update(payload).digest('hex')
    const forgedToken = `${payload}.${hmac}`

    expect(verifySession(forgedToken)).toBe(false)
  })

  it('aceita um token bem dentro da janela de validade de 30 dias', () => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    const payload = String(oneDayAgo)
    const hmac = crypto.createHmac('sha256', 'test-secret').update(payload).digest('hex')
    const stillValidToken = `${payload}.${hmac}`

    expect(verifySession(stillValidToken)).toBe(true)
  })
})
