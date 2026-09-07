import { describe, it, expect, beforeEach } from 'vitest'
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
})
