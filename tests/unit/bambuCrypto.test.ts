import { describe, it, expect, beforeEach } from 'vitest'
import { encryptCredential, decryptCredential } from '@/lib/bambu/crypto'

describe('bambu credential crypto', () => {
  beforeEach(() => {
    process.env.BAMBU_CREDENTIAL_KEY = 'a'.repeat(64) // 32 bytes em hex
  })

  it('round-trips a plaintext value', () => {
    const cipher = encryptCredential('meu-token-secreto')
    expect(cipher).not.toContain('meu-token-secreto')
    expect(decryptCredential(cipher)).toBe('meu-token-secreto')
  })

  it('produces a different ciphertext each time (IV aleatório)', () => {
    const a = encryptCredential('mesmo-valor')
    const b = encryptCredential('mesmo-valor')
    expect(a).not.toBe(b)
  })

  it('throws when BAMBU_CREDENTIAL_KEY is missing', () => {
    delete process.env.BAMBU_CREDENTIAL_KEY
    expect(() => encryptCredential('x')).toThrow('BAMBU_CREDENTIAL_KEY')
  })
})
