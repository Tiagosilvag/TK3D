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
// Partner/Product/Printer/Filament). A delivery with no sale reports yet can
// be removed physically to fix a mistake; one that already has sale reports
// against it must be kept so that history stays consistent — deleting it
// would silently break the remaining-balance math for those reports.
export async function deleteConsignmentDelivery(id: string): Promise<ActionResult> {
  const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({
    where: { id },
    include: { saleReports: true },
  })
  if (delivery.saleReports.length > 0) {
    return { success: false, error: 'Não é possível remover uma entrega que já tem relatórios de venda' }
  }
  await prisma.consignmentDelivery.delete({ where: { id } })
  revalidatePath('/consignment/deliveries')
  return { success: true }
}
