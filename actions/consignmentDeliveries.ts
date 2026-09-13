'use server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { consignmentDeliverySchema, consignmentDeliveryBatchSchema } from '@/lib/validation/consignment'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return consignmentDeliverySchema.safeParse({
    ...raw,
    colorComboKey: raw.colorComboKey || null,
    notes: raw.notes || null,
  })
}

// Item de 1 produto só (usado por testes/integrações diretas) -- gera seu
// próprio batchId (um lote de 1 item), mesmo comportamento retroativo que a
// migration deu a toda linha pré-existente. O modal "Registrar entrega" da
// UI usa createConsignmentDeliveryBatch abaixo, não esta função.
export async function createConsignmentDelivery(formData: FormData): Promise<ActionResult> {
  const parsed = parse(formData)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  await prisma.consignmentDelivery.create({ data: { ...parsed.data, batchId: randomUUID() } })
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Melhoria "Entregas em consignação" §3: uma entrega real leva vários
// produtos/cores de uma vez -- esta action cria todas as linhas de uma
// submissão do modal "Registrar entrega" numa transação só, todas
// compartilhando um batchId gerado aqui (ver comentário de
// ConsignmentDelivery.batchId em prisma/schema.prisma). partnerId/
// deliveryDate/notes ficam no nível do lote (repetidos em cada linha,
// nunca uma tabela "evento" própria -- ver justificativa no schema).
export async function createConsignmentDeliveryBatch(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  let items: unknown
  try {
    items = JSON.parse(String(raw.itemsJson ?? '[]'))
  } catch {
    return { success: false, error: 'Itens da entrega inválidos' }
  }

  const parsed = consignmentDeliveryBatchSchema.safeParse({
    partnerId: raw.partnerId,
    deliveryDate: raw.deliveryDate,
    notes: raw.notes || null,
    items,
  })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const batchId = randomUUID()
  await prisma.consignmentDelivery.createMany({
    data: parsed.data.items.map((item) => ({
      batchId,
      partnerId: parsed.data.partnerId,
      deliveryDate: parsed.data.deliveryDate,
      notes: parsed.data.notes,
      productId: item.productId,
      colorComboKey: item.colorComboKey ?? null,
      quantityDelivered: item.quantityDelivered,
      unitPrice: item.unitPrice,
    })),
  })
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// ConsignmentDelivery has no soft-delete flag (it's not a catalog entity like
// Partner/Product/Printer/Filament) -- physical delete, same as
// ConsignmentSaleReport itself. Bug "TEM Q SER POSSIVEL REMOVER": removing a
// delivery that already had sale reports against it used to be blocked
// outright (deleting it would silently break the remaining-balance math for
// those reports). Now it cascades instead of blocking -- removing the whole
// delivery event means undoing everything recorded against it, so its sale
// reports go together, in the same transaction (both succeed or neither
// does). The UI (DeliveriesExplorer) warns how many reports will go with it
// before confirming.
export async function deleteConsignmentDelivery(id: string): Promise<ActionResult> {
  await prisma.$transaction([
    prisma.consignmentSaleReport.deleteMany({ where: { deliveryId: id } }),
    prisma.consignmentDelivery.delete({ where: { id } }),
  ])
  revalidatePath('/consignment/deliveries')
  revalidatePath('/consignment/reports')
  return { success: true }
}

// Melhoria "ajustar a quantidade" (mesmo pedido do bug acima): corrige uma
// entrega já registrada (quantidade errada) sem precisar apagar e recriar
// -- min de `quantitySold` (não dá pra baixar pra menos do que já foi
// vendido; vender mais não é limitado, é só aumentar a entrega). Estoque
// disponível em toda tela (Parceiros, Relatórios de venda, esta mesma
// lista) é sempre derivado de quantityDelivered - vendido ao vivo, nunca um
// contador redundante, então este update já reflete em tudo sozinho.
export async function updateConsignmentDeliveryQuantity(id: string, formData: FormData): Promise<ActionResult> {
  const quantityDelivered = parseInt(String(formData.get('quantityDelivered') ?? ''), 10)
  if (!Number.isFinite(quantityDelivered) || quantityDelivered <= 0) {
    return { success: false, error: 'Quantidade inválida' }
  }

  const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({
    where: { id },
    include: { saleReports: true },
  })
  const alreadySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
  if (quantityDelivered < alreadySold) {
    return { success: false, error: `Quantidade não pode ser menor que o já vendido (${alreadySold})` }
  }

  await prisma.consignmentDelivery.update({ where: { id }, data: { quantityDelivered } })
  revalidatePath('/consignment/deliveries')
  return { success: true }
}
