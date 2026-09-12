import { describe, it, expect } from 'vitest'
import { extractSlicerTokenFromText } from '@/lib/anycubic/tokenExtraction'

describe('extractSlicerTokenFromText', () => {
  it('extrai o token do formato de log novo (Slicer Next 1.4.1.2+)', () => {
    const logLine =
      '[warning] 2026-09-12 14:15:16.972720[Thread 0x000067ac]:AnycubicContext::login, accessToken = eyJhbGciOiJSUzI1NiJ9.payload.signature, outro=campo'
    expect(extractSlicerTokenFromText(logLine)).toBe('eyJhbGciOiJSUzI1NiJ9.payload.signature')
  })

  it('extrai o token do formato .conf antigo (JSON com access_token)', () => {
    const confText = '{"other": "field", "access_token": "eyJhbGciOiJSUzI1NiJ9.payload.signature", "region": "cn"}'
    expect(extractSlicerTokenFromText(confText)).toBe('eyJhbGciOiJSUzI1NiJ9.payload.signature')
  })

  it('usa a ÚLTIMA ocorrência quando o arquivo tem múltiplas linhas de login', () => {
    const logText = [
      'accessToken = token-antigo-123',
      'accessToken = token-mais-recente-456',
    ].join('\n')
    expect(extractSlicerTokenFromText(logText)).toBe('token-mais-recente-456')
  })

  it('devolve null quando não encontra nenhum padrão conhecido', () => {
    expect(extractSlicerTokenFromText('arquivo sem token nenhum aqui')).toBeNull()
  })
})
