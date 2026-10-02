import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeOrderItems, fetchOrderFromApi, searchRecentOrders } from '@/lib/mercadoLivre/orders'

describe('normalizeOrderItems', () => {
  it('extrai título, sku, quantidade e preço unitário de cada item', () => {
    const payload = {
      id: 123,
      buyer: { nickname: 'comprador1' },
      total_amount: 150.5,
      order_items: [
        { item: { id: 'MLB1', title: 'Chaveiro Gato', seller_sku: 'CHV-GATO' }, quantity: 2, unit_price: 50 },
        { item: { id: 'MLB2', title: 'Chaveiro Cão', seller_sku: null }, quantity: 1, unit_price: 50.5 },
      ],
    }
    const items = normalizeOrderItems(payload as never)
    expect(items).toEqual([
      { externalItemId: 'MLB1', title: 'Chaveiro Gato', sku: 'CHV-GATO', quantity: 2, unitPrice: 50 },
      { externalItemId: 'MLB2', title: 'Chaveiro Cão', sku: null, quantity: 1, unitPrice: 50.5 },
    ])
  })
})

describe('fetchOrderFromApi', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('busca o pedido com Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 123 }) })
    global.fetch = fetchMock as unknown as typeof fetch
    const order = await fetchOrderFromApi('tok-1', '123')
    expect(order).toEqual({ id: 123 })
    expect(fetchMock).toHaveBeenCalledWith('https://api.mercadolibre.com/orders/123', { headers: { Authorization: 'Bearer tok-1' } })
  })

  it('lança erro com resposta não-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch
    await expect(fetchOrderFromApi('tok-1', '999')).rejects.toThrow('Falha ao buscar pedido 999 no Mercado Livre')
  })
})

describe('searchRecentOrders', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('devolve os ids dos pedidos encontrados', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ id: 1 }, { id: 2 }] }) })
    global.fetch = fetchMock as unknown as typeof fetch
    const ids = await searchRecentOrders('tok-1', '999', '2026-10-02T00:00:00.000-00:00')
    expect(ids).toEqual(['1', '2'])
  })
})
