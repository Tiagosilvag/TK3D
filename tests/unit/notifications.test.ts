import { describe, it, expect } from 'vitest'
import { areAllItemsTerminal } from '@/lib/notifications'

describe('areAllItemsTerminal', () => {
  it('true quando todos os itens estão ENTREGUE', () => {
    expect(areAllItemsTerminal(['ENTREGUE', 'ENTREGUE'])).toBe(true)
  })

  it('true quando misto de ENTREGUE e CANCELADO', () => {
    expect(areAllItemsTerminal(['ENTREGUE', 'CANCELADO'])).toBe(true)
  })

  it('false quando algum item ainda não está em status terminal', () => {
    expect(areAllItemsTerminal(['ENTREGUE', 'AGUARDANDO_PRODUCAO'])).toBe(false)
  })

  it('true pra lista vazia (vacuously true, nunca deveria acontecer na prática mas não deve travar)', () => {
    expect(areAllItemsTerminal([])).toBe(true)
  })
})
