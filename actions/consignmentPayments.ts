'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { getPartnerCommissionTotals } from '@/lib/consignmentCommission'

type PaymentResult = { success: boolean; error?: string; paymentId?: string }

function refresh() {
  revalidatePath('/consignment/partners')
  revalidatePath('/dashboard')
}

const cents = (n: number) => Math.round(n * 100) / 100

// Paga (toda ou parte da) comissão de um parceiro em 1 clique. Recusa pagar
// mais do que ainda está a pagar -- "a pagar" é sempre comissão das vendas −
// pagamentos já feitos.
export async function payPartnerCommission(partnerId: string, amount: number): Promise<PaymentResult> {
  const value = cents(amount)
  if (!(value > 0)) return { success: false, error: 'Informe um valor maior que zero.' }
  const totals = await getPartnerCommissionTotals(partnerId)
  if (value > totals.due + 0.001) {
    return { success: false, error: `O valor passa do que está a pagar (R$ ${totals.due.toFixed(2).replace('.', ',')}).` }
  }
  const payment = await prisma.consignmentPartnerPayment.create({ data: { partnerId, amount: value, paidAt: new Date() } })
  refresh()
  return { success: true, paymentId: payment.id }
}

// Desfazer/excluir um pagamento registrado.
export async function deletePartnerPayment(id: string): Promise<{ success: boolean; error?: string }> {
  const existing = await prisma.consignmentPartnerPayment.findUnique({ where: { id } })
  if (!existing) return { success: false, error: 'Pagamento não encontrado.' }
  await prisma.consignmentPartnerPayment.delete({ where: { id } })
  refresh()
  return { success: true }
}

// Corrige o valor ou a data de um pagamento. Depois da mudança, o total pago
// nunca pode passar da comissão total (a alteração é recusada e nada muda).
export async function updatePartnerPayment(id: string, amount: number, paidAt?: string): Promise<{ success: boolean; error?: string; previousAmount?: number }> {
  const value = cents(amount)
  if (!(value > 0)) return { success: false, error: 'Informe um valor maior que zero.' }
  const existing = await prisma.consignmentPartnerPayment.findUnique({ where: { id } })
  if (!existing) return { success: false, error: 'Pagamento não encontrado.' }
  const totals = await getPartnerCommissionTotals(existing.partnerId)
  const paidWithout = totals.paid - existing.amount.toNumber()
  if (paidWithout + value > totals.commission + 0.001) {
    return { success: false, error: `Os pagamentos passariam da comissão total (R$ ${totals.commission.toFixed(2).replace('.', ',')}).` }
  }
  const date = paidAt ? new Date(`${paidAt}T12:00:00`) : undefined
  if (date && Number.isNaN(date.getTime())) return { success: false, error: 'Data inválida.' }
  await prisma.consignmentPartnerPayment.update({ where: { id }, data: { amount: value, ...(date ? { paidAt: date } : {}) } })
  refresh()
  return { success: true, previousAmount: existing.amount.toNumber() }
}
