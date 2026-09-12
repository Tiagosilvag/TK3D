import { describe, it, expect } from 'vitest'
import { extractSlicerTokenFromText, pickSlicerTokenFromCandidates } from '@/lib/anycubic/tokenExtraction'

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

describe('pickSlicerTokenFromCandidates', () => {
  it('escolhe o token do arquivo mais recente (por lastModified) quando ele tem um login válido', () => {
    const token = pickSlicerTokenFromCandidates([
      { name: 'debug_1.log', lastModified: 1000, text: 'accessToken = token-antigo' },
      { name: 'debug_2.log', lastModified: 3000, text: 'accessToken = token-mais-novo' },
      { name: 'debug_3.log', lastModified: 2000, text: 'accessToken = token-do-meio' },
    ])
    expect(token).toBe('token-mais-novo')
  })

  it('pula pro arquivo mais recente seguinte quando o mais novo não tem login registrado (ex.: app acabou de atualizar)', () => {
    const token = pickSlicerTokenFromCandidates([
      { name: 'debug_antigo.log', lastModified: 1000, text: 'accessToken = token-do-arquivo-antigo' },
      { name: 'debug_novo.log', lastModified: 2000, text: 'nada de login aqui ainda' },
    ])
    expect(token).toBe('token-do-arquivo-antigo')
  })

  it('devolve null quando nenhum arquivo da pasta tem um token', () => {
    const token = pickSlicerTokenFromCandidates([
      { name: 'debug_1.log', lastModified: 1000, text: 'sem token' },
      { name: 'debug_2.log', lastModified: 2000, text: 'também sem token' },
    ])
    expect(token).toBeNull()
  })

  it('devolve null pra lista vazia', () => {
    expect(pickSlicerTokenFromCandidates([])).toBeNull()
  })
})
