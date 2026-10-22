import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export interface PackagingLineInput {
  packagingItemId: string
  quantityPerUnit: number
}

// Embalagem escolhida pra ESTA venda (quantidade por unidade × quantidade
// vendida), debitada na venda e gravada em StockConsumption -- nunca na
// montagem. Estoque pode ficar negativo de propósito: é aviso, não bloqueio.
export async function consumePackagingLines(tx: Tx, saleId: string, productId: string, lines: PackagingLineInput[], quantity: number): Promise<void> {
  for (const line of lines) {
    if (!(line.quantityPerUnit > 0)) continue
    const consumed = line.quantityPerUnit * quantity
    await tx.packagingItem.update({ where: { id: line.packagingItemId }, data: { currentStock: { decrement: consumed } } })
    await tx.stockConsumption.create({
      data: { resourceType: 'PACKAGING', resourceId: line.packagingItemId, quantity: consumed, productId, source: 'SALE', sourceId: saleId },
    })
  }
}
