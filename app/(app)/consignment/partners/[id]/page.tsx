import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getConsignmentPartnerDetail } from '@/lib/reports'
import { PartnerDetailHeader } from './PartnerDetailHeader'
import { PartnerFinancialSummary } from './PartnerFinancialSummary'
import { PartnerStockSection } from './PartnerStockSection'
import { PartnerMovements } from './PartnerMovements'
import { PartnerCommissionBlock } from './PartnerCommissionBlock'
import { PartnerQuickStock } from './PartnerQuickStock'
import { prisma } from '@/lib/prisma'
import { resolveOrderItemColorLabel } from '@/actions/orders'
import { PendingDeliveriesPanel, type ReadyOrderRow } from '../../../sales/PendingDeliveriesPanel'

export const dynamic = 'force-dynamic'

export default async function ConsignmentPartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getConsignmentPartnerDetail(id)
  if (!detail) notFound()

  // Pedidos dela já prontos (variação reservada): "✓ Entregar" cria a entrega.
  const readyRecords = await prisma.orderItem.findMany({
    where: { reservedQuantity: { gt: 0 }, status: { notIn: ['ENTREGUE', 'CANCELADO'] }, order: { consignmentPartnerId: id, channel: 'CONSIGNADO' } },
    include: { product: { select: { name: true } }, order: { select: { buyerOrPlatform: true, deliveryDate: true } } },
    orderBy: { order: { deliveryDate: 'asc' } },
  })
  const readyOrders: ReadyOrderRow[] = await Promise.all(
    readyRecords.map(async (i) => ({
      id: i.id,
      productName: i.product.name,
      quantity: i.reservedQuantity,
      ofTotal: i.quantity,
      unitPrice: i.unitPrice.toNumber(),
      buyer: null,
      channelLabel: 'Consignação',
      deliveryLabel: i.order.deliveryDate.toLocaleDateString('pt-BR'),
      variation: i.colorComboKey ? ((await resolveOrderItemColorLabel(i.productId, i.colorComboKey))?.label ?? null) : null,
    })),
  )

  const productsWithStock = detail.products.filter((p) => p.remaining > 0).length

  return (
    <div className="tk-page">
      <Link href="/consignment/partners" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        &larr; Parceiros de consignação
      </Link>

      <div className="mt-2">
        <PartnerDetailHeader
          partner={{
            id: detail.partnerId,
            name: detail.partnerName,
            defaultCommissionPercent: detail.defaultCommissionPercent,
            notes: detail.notes,
          }}
        />
      </div>

      <div className="mt-6">
        <PartnerFinancialSummary detail={detail} productsWithStock={productsWithStock} />
      </div>

      {readyOrders.length > 0 && (
        <div className="mt-6">
          <PendingDeliveriesPanel
            rows={readyOrders}
            title="Pedidos dela prontos para entregar"
            hint="✓ Entregar cria a entrega para a parceira com o preço do pedido e baixa o pedido da fila."
            doneLabel="Entrega registrada"
          />
        </div>
      )}

      <div className="mt-6">
        <PartnerCommissionBlock
          partnerId={detail.partnerId}
          grossSold={detail.soldValue}
          commissionTotal={detail.commissionOwed}
          paid={detail.commissionPaid}
          due={detail.commissionDue}
          payments={detail.payments.map((p) => ({ id: p.id, amount: p.amount, paidAt: p.paidAt.toISOString() }))}
        />
      </div>

      <div className="mt-6">
        <PartnerQuickStock partnerId={detail.partnerId} products={detail.products} />
      </div>

      <div className="mt-6">
        <PartnerStockSection
          products={detail.products}
          saleableDeliveries={detail.saleableDeliveries}
          defaultCommissionPercent={detail.defaultCommissionPercent}
          partnerName={detail.partnerName}
        />
      </div>

      <div className="mt-6">
        <PartnerMovements partnerId={detail.partnerId} ledger={detail.ledger} payments={detail.payments.map((p) => ({ id: p.id, amount: p.amount, paidAt: p.paidAt.toISOString() }))} />
      </div>
    </div>
  )
}
