import { describe, it, expect, vi, afterEach } from 'vitest'
import * as connection from '@/lib/mercadoLivre/connection'
import * as orders from '@/lib/mercadoLivre/orders'
import { runReconciliationOnce } from '@/lib/mercadoLivre/reconciliationPoller'

describe('runReconciliationOnce', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('não faz nada se não há conexão ativa', async () => {
    vi.spyOn(connection, 'getConnectionStatus').mockResolvedValue(null)
    const searchSpy = vi.spyOn(orders, 'searchRecentOrders')
    await runReconciliationOnce()
    expect(searchSpy).not.toHaveBeenCalled()
  })

  it('busca pedidos recentes e processa cada um', async () => {
    vi.spyOn(connection, 'getConnectionStatus').mockResolvedValue({
      id: '1', platform: 'MERCADO_LIVRE', sellerId: '999', status: 'CONECTADA',
    } as never)
    vi.spyOn(connection, 'getValidAccessToken').mockResolvedValue('tok-1')
    vi.spyOn(orders, 'searchRecentOrders').mockResolvedValue(['111', '222'])
    const processSpy = vi.spyOn(orders, 'processOrderNotification').mockResolvedValue(undefined)

    await runReconciliationOnce()

    expect(processSpy).toHaveBeenCalledWith('111')
    expect(processSpy).toHaveBeenCalledWith('222')
  })

  it('erro ao processar um pedido não impede os outros de serem processados', async () => {
    vi.spyOn(connection, 'getConnectionStatus').mockResolvedValue({
      id: '1', platform: 'MERCADO_LIVRE', sellerId: '999', status: 'CONECTADA',
    } as never)
    vi.spyOn(connection, 'getValidAccessToken').mockResolvedValue('tok-1')
    vi.spyOn(orders, 'searchRecentOrders').mockResolvedValue(['111', '222'])
    const processSpy = vi
      .spyOn(orders, 'processOrderNotification')
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce(undefined)

    await expect(runReconciliationOnce()).resolves.not.toThrow()
    expect(processSpy).toHaveBeenCalledTimes(2)
  })
})
