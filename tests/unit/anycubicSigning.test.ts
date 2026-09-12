import { describe, it, expect } from 'vitest'
import { buildSignedHeaders } from '@/lib/anycubic/signing'

describe('anycubic buildSignedHeaders', () => {
  it('monta os headers assinados com MD5(appId+timestamp+appVersion+appSecret+nonce+appId)', () => {
    const headers = buildSignedHeaders({ nonce: 'fixed-nonce', timestamp: 1700000000000 })

    expect(headers['Xx-Signature']).toBe('7aaeb415fb49eb5720b8c384968a4633')
    expect(headers['Xx-Device-Type']).toBe('pcf')
    expect(headers['Xx-Is-Cn']).toBe('1')
    expect(headers['Xx-Nonce']).toBe('fixed-nonce')
    expect(headers['Xx-Timestamp']).toBe('1700000000000')
    expect(headers['Xx-Version']).toBe('V3.0.0')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['XX-LANGUAGE']).toBe('US')
    expect(headers['XX-Token']).toBeUndefined()
  })

  it('inclui XX-Token quando authToken é passado', () => {
    const headers = buildSignedHeaders({ nonce: 'fixed-nonce', timestamp: 1700000000000, authToken: 'session-token-abc' })
    expect(headers['XX-Token']).toBe('session-token-abc')
  })
})
