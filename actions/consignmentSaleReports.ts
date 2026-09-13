'use server'
import { prisma } from '@/lib/prisma'
import { consignmentSaleReportSchema, consignmentSaleReportBatchSchema } from '@/lib/validation/consignment'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

// The balance check below (quantitySold <= remaining) cannot be expressed in
// the Zod schema alone because it depends on a database query — the sum of
// quantitySold already reported against this same delivery. It is validated
// here, after the Zod parse, and before the row is created.
export async function createConsignmentSaleReport(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  const parsed = consignmentSaleReportSchema.safeParse({
    ...raw,
    notes: raw.notes || null,
    unitPrice: raw.unitPrice || null,
  })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({
    where: { id: parsed.data.deliveryId },
    include: { saleReports: true },
  })
  const alreadySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
  const remaining = Math.max(0, delivery.quantityDelivered - alreadySold)
  if (parsed.data.quantitySold > remaining) {
    return { success: false, error: `Quantidade excede o saldo disponível (${remaining})` }
  }

  await prisma.consignmentSaleReport.create({ data: parsed.data })
  revalidatePath('/consignment/reports')
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Melhoria "Registrar venda" (parceiros de consignação): "selecionar todos
// os produtos entregues e disponíveis pra lançar a venda de uma vez" --
// mesmo padrão de createProductionRunBatch (checagem de saldo de cada
// item ANTES de escrever qualquer coisa, tudo dentro de uma transação só,
// pra um lote com algum item sem saldo suficiente não gravar nada, nem os
// outros itens que passariam no check).
export async function createConsignmentSaleReportBatch(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  let items: unknown = []
  try {
    items = JSON.parse(String(raw.itemsJson ?? '[]'))
  } catch {
    items = []
  }
  const parsed = consignmentSaleReportBatchSchema.safeParse({ reportDate: raw.reportDate, notes: raw.notes || null, items })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const deliveries = await prisma.consignmentDelivery.findMany({
    where: { id: { in: parsed.data.items.map((i) => i.deliveryId) } },
    include: { saleReports: true },
  })
  const deliveryById = new Map(deliveries.map((d) => [d.id, d]))

  for (const item of parsed.data.items) {
    const delivery = deliveryById.get(item.deliveryId)
    if (!delivery) return { success: false, error: 'Entrega não encontrada' }
    const alreadySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
    const remaining = Math.max(0, delivery.quantityDelivered - alreadySold)
    if (item.quantitySold > remaining) {
      return { success: false, error: `Quantidade excede o saldo disponível (${remaining}) de ${delivery.id}` }
    }
  }

  await prisma.$transaction(
    parsed.data.items.map((item) =>
      prisma.consignmentSaleReport.create({
        data: {
          deliveryId: item.deliveryId,
          quantitySold: item.quantitySold,
          commissionPercent: item.commissionPercent,
          unitPrice: item.unitPrice ?? null,
          reportDate: parsed.data.reportDate,
          notes: parsed.data.notes,
        },
      }),
    ),
  )
  revalidatePath('/consignment/reports')
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Historical log like ProductionRun: physical delete only, no active field.
export async function deleteConsignmentSaleReport(id: string): Promise<ActionResult> {
  await prisma.consignmentSaleReport.delete({ where: { id } })
  revalidatePath('/consignment/reports')
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

export async function getPartnerStock(partnerId: string) {
  const deliveries = await prisma.consignmentDelivery.findMany({
    where: { partnerId },
    include: { product: true, saleReports: true },
  })
  return deliveries.map((d) => {
    const sold = d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
    return {
      productId: d.productId,
      productName: d.product.name,
      delivered: d.quantityDelivered,
      sold,
      remaining: Math.max(0, d.quantityDelivered - sold),
    }
  })
}
