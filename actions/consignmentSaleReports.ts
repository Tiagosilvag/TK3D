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
//
// Bug "2 entregas do mesmo produto+cor viravam 2 linhas em vez de somar o
// saldo": um item agora é um GRUPO produto+cor com `deliveryIds` (mais
// antiga primeiro, ver ConsignmentSaleableDelivery em lib/reports.ts) --
// a quantidade vendida é consumida nessa ordem (FIFO), "atravessando" pra
// a próxima entrega do grupo quando a primeira não basta sozinha. Cada
// entrega efetivamente tocada vira seu próprio ConsignmentSaleReport (o
// schema exige 1 deliveryId por relatório), todos com o MESMO preço/
// comissão/data/observações -- só a quantidade difere entre eles.
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

  const allDeliveryIds = [...new Set(parsed.data.items.flatMap((i) => i.deliveryIds))]
  const deliveries = await prisma.consignmentDelivery.findMany({
    where: { id: { in: allDeliveryIds } },
    include: { saleReports: true, product: true },
  })
  const deliveryById = new Map(deliveries.map((d) => [d.id, d]))

  const plannedReports: { deliveryId: string; quantitySold: number; commissionPercent: number; unitPrice: number }[] = []
  for (const item of parsed.data.items) {
    let remainingToSell = item.quantitySold
    let productName = ''
    for (const deliveryId of item.deliveryIds) {
      if (remainingToSell <= 0) break
      const delivery = deliveryById.get(deliveryId)
      if (!delivery) return { success: false, error: 'Entrega não encontrada' }
      productName = delivery.product.name
      const alreadySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
      const deliveryRemaining = Math.max(0, delivery.quantityDelivered - alreadySold)
      if (deliveryRemaining <= 0) continue
      const take = Math.min(deliveryRemaining, remainingToSell)
      plannedReports.push({ deliveryId, quantitySold: take, commissionPercent: item.commissionPercent, unitPrice: item.unitPrice })
      remainingToSell -= take
    }
    if (remainingToSell > 0) {
      const totalAvailable = item.quantitySold - remainingToSell
      return { success: false, error: `Quantidade excede o saldo disponível (${totalAvailable}) de ${productName || 'um item'}` }
    }
  }

  await prisma.$transaction(
    plannedReports.map((r) =>
      prisma.consignmentSaleReport.create({
        data: {
          deliveryId: r.deliveryId,
          quantitySold: r.quantitySold,
          commissionPercent: r.commissionPercent,
          unitPrice: r.unitPrice,
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

// Melhoria "editar tudo no consignado": corrige um relatório de venda já
// registrado (quantidade/preço/comissão/data errados) sem precisar apagar e
// recriar -- mesma checagem de saldo de createConsignmentSaleReport, só que
// exclui o PRÓPRIO relatório da soma de "já vendido" (senão a quantidade
// dele contaria contra si mesma e o saldo pareceria menor do que realmente
// é). Reduzir quantitySold aqui já devolve a diferença pro saldo do
// parceiro, mesmo cálculo derivado (entregue - vendido) que o delete usa.
export async function updateConsignmentSaleReport(id: string, formData: FormData): Promise<ActionResult> {
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
  const alreadySold = delivery.saleReports.filter((r) => r.id !== id).reduce((sum, r) => sum + r.quantitySold, 0)
  const remaining = Math.max(0, delivery.quantityDelivered - alreadySold)
  if (parsed.data.quantitySold > remaining) {
    return { success: false, error: `Quantidade excede o saldo disponível (${remaining})` }
  }

  await prisma.consignmentSaleReport.update({ where: { id }, data: parsed.data })
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
