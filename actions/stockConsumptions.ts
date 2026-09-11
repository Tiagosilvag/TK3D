'use server'
import { prisma } from '@/lib/prisma'
import type { StockConsumptionResourceType } from '@prisma/client'

// Melhoria "Histórico de consumo": mesmo formato de
// actions/stockAdjustments.ts#getStockAdjustmentHistory -- Decimal do
// Prisma convertido pra number antes de sair da action (não é
// serializável como prop de Server pra Client Component em todo caso, e
// nenhuma tela aqui precisa de mais casas decimais do que number aguenta).
export interface StockConsumptionHistoryRow {
  id: string
  quantity: number
  productId: string
  productName: string
  source: 'ASSEMBLY' | 'SALE'
  consumedAt: Date
}

export async function getStockConsumptionHistory(
  resourceType: StockConsumptionResourceType,
  resourceId: string,
): Promise<StockConsumptionHistoryRow[]> {
  const rows = await prisma.stockConsumption.findMany({
    where: { resourceType, resourceId },
    include: { product: { select: { name: true } } },
    orderBy: { consumedAt: 'desc' },
  })
  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity.toNumber(),
    productId: r.productId,
    productName: r.product.name,
    source: r.source,
    consumedAt: r.consumedAt,
  }))
}
