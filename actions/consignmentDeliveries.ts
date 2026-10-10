'use server'
import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { consignmentDeliverySchema, consignmentDeliveryBatchSchema } from '@/lib/validation/consignment'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003'
}

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
  try {
    await prisma.$transaction([
      prisma.consignmentSaleReport.deleteMany({ where: { deliveryId: id } }),
      prisma.consignmentDelivery.delete({ where: { id } }),
    ])
  } catch (err) {
    // Bug "Excluir antes de Cancelar dá um bug" (mesma classe, ver
    // actions/orders.ts#deleteOrder): janela de corrida rara -- um
    // ConsignmentSaleReport novo criado pra esta entrega entre o
    // deleteMany acima e o delete, por uma requisição concorrente. Sem
    // isso, a FK RESTRICT propagaria um erro cru pra tela.
    if (isForeignKeyConstraintError(err)) {
      return { success: false, error: 'Não foi possível excluir esta entrega porque um relatório de venda foi registrado para ela nesse meio-tempo. Tente novamente.' }
    }
    throw err
  }
  revalidatePath('/consignment/deliveries')
  revalidatePath('/consignment/reports')
  return { success: true }
}

// Melhoria "ajustar a quantidade" (mesmo pedido do bug acima): corrige uma
// entrega já registrada (quantidade errada) sem precisar apagar e recriar
// -- min de `quantitySold + returnedQuantity` (não dá pra baixar pra menos
// do que já saiu, seja vendido ou devolvido; aumentar não é limitado). Bug
// "editar tudo no consignado" (revisão): esta função corrige o FATO original
// (quanto realmente foi entregue), diferente de returnConsignmentDeliveryStock
// abaixo (que registra uma devolução física em cima do fato já correto) --
// as duas nunca se confundem porque cada uma mexe num campo diferente.
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
  const floor = alreadySold + delivery.returnedQuantity
  if (quantityDelivered < floor) {
    return { success: false, error: `Quantidade não pode ser menor que o já vendido/devolvido (${floor})` }
  }

  await prisma.consignmentDelivery.update({ where: { id }, data: { quantityDelivered } })
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Bug "editar o valor não dá": a coluna "Preço unit." no modal de detalhe de
// uma entrega (DeliveriesExplorer) só mostrava o valor, sem forma nenhuma de
// corrigi-lo depois de registrado (preço errado na hora de registrar a
// entrega não tinha como ser consertado sem excluir e recriar a linha
// inteira) -- mesmo padrão de updateConsignmentDeliveryQuantity acima, só
// que pro preço em vez da quantidade. Nunca mexe em relatório de venda já
// registrado contra esta entrega (ConsignmentSaleReport.unitPrice é
// congelado no momento da venda, igual costSnapshot -- ver comentário do
// schema), só o preço de referência pras vendas FUTURAS contra esta linha.
export async function updateConsignmentDeliveryUnitPrice(id: string, formData: FormData): Promise<ActionResult> {
  const unitPrice = Number(String(formData.get('unitPrice') ?? '').replace(',', '.'))
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return { success: false, error: 'Preço inválido' }
  }

  await prisma.consignmentDelivery.update({ where: { id }, data: { unitPrice } })
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Pedido "caso eu queira pegar alguma peça que esteja com o parceiro eu
// consigo, voltando pro meu estoque" + revisão "quero que ao devolver marque
// igual quando é cancelado, com opção de desfazer/apagar -- a mesma lógica
// de produção": ao contrário da 1ª volta desta função (que decrementava
// quantityDelivered direto), agora incrementa `returnedQuantity` --
// quantityDelivered nunca é reescrito, fica como fato histórico congelado
// pra sempre (igual ProductionRun.status=CANCELADA nunca apaga
// quantityPlanned/quantitySuccess da run cancelada). "Com ela" em toda tela
// já é derivado de quantityDelivered - vendido - returnedQuantity (lib/
// reports.ts), então este increment sozinho já reflete em tudo, inclusive
// "Meu estoque" (CLAUDE.md "Estoque derivado").
export async function returnConsignmentDeliveryStock(id: string, formData: FormData): Promise<ActionResult> {
  const quantityReturned = parseInt(String(formData.get('quantityReturned') ?? ''), 10)
  if (!Number.isFinite(quantityReturned) || quantityReturned <= 0) {
    return { success: false, error: 'Quantidade inválida' }
  }

  const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({
    where: { id },
    include: { saleReports: true },
  })
  const alreadySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
  const remaining = Math.max(0, delivery.quantityDelivered - alreadySold - delivery.returnedQuantity)
  if (quantityReturned > remaining) {
    return { success: false, error: `Não é possível devolver mais do que está com o parceiro (${remaining})` }
  }

  await prisma.consignmentDelivery.update({ where: { id }, data: { returnedQuantity: { increment: quantityReturned } } })
  revalidatePath('/consignment/deliveries')
  revalidatePath('/consignment/partners')
  return { success: true }
}

// Pedido "quero q tenha a opção de desfazer também uma devolução, se marcou
// errado -- mas somente qnd ele fica devolvido": zera returnedQuantity,
// trazendo a entrega de volta ao estado "com o parceiro" de antes de
// qualquer devolução -- só permitido quando a entrega está no estado
// "Devolvida" (saldo zerado POR devolução, não por venda; ver
// PartnerStockSection.tsx), pra não desfazer uma devolução parcial que
// ainda deixa saldo ativo (essa continua editável direto pelo campo de
// quantidade, sem precisar de "desfazer"). Diferente de Produção (que não
// tem "reativar" uma run CANCELADA) -- pedido explícito aqui, atendido.
export async function undoConsignmentDeliveryReturn(id: string): Promise<ActionResult> {
  const delivery = await prisma.consignmentDelivery.findUniqueOrThrow({
    where: { id },
    include: { saleReports: true },
  })
  const alreadySold = delivery.saleReports.reduce((sum, r) => sum + r.quantitySold, 0)
  const remaining = Math.max(0, delivery.quantityDelivered - alreadySold - delivery.returnedQuantity)
  if (!(remaining === 0 && delivery.returnedQuantity > 0)) {
    return { success: false, error: 'Esta entrega não está devolvida' }
  }

  await prisma.consignmentDelivery.update({ where: { id }, data: { returnedQuantity: 0 } })
  revalidatePath('/consignment/deliveries')
  revalidatePath('/consignment/partners')
  return { success: true }
}
