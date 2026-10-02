import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchActiveListings } from '@/lib/mercadoLivre/listings'

describe('fetchActiveListings', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('busca os ids do vendedor e depois os detalhes de cada item', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: ['MLB1', 'MLB2'] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { code: 200, body: { id: 'MLB1', title: 'Produto A', price: 50, available_quantity: 10, permalink: 'https://ml/a' } },
          { code: 200, body: { id: 'MLB2', title: 'Produto B', price: 30, available_quantity: 5, permalink: 'https://ml/b' } },
        ],
      })
    global.fetch = fetchMock as unknown as typeof fetch

    const listings = await fetchActiveListings('tok-1', '999')

    expect(listings).toEqual([
      { id: 'MLB1', title: 'Produto A', price: 50, availableQuantity: 10, permalink: 'https://ml/a' },
      { id: 'MLB2', title: 'Produto B', price: 30, availableQuantity: 5, permalink: 'https://ml/b' },
    ])
  })

  it('devolve lista vazia sem segunda chamada quando o vendedor não tem anúncio ativo', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) })
    global.fetch = fetchMock as unknown as typeof fetch
    const listings = await fetchActiveListings('tok-1', '999')
    expect(listings).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lança erro se a busca de ids falhar', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch
    await expect(fetchActiveListings('tok-1', '999')).rejects.toThrow('Falha ao buscar anúncios no Mercado Livre')
  })
})
