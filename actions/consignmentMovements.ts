'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

// "✓ Vendeu 1" / "↩ Devolver 1" por VARIAÇÃO (parceiro + produto + cor exata),
// consumindo as entregas em ordem (a mais antiga primeiro). Cliques seguidos
// se juntam: venda no mesmo dia, mesma comissão e mesmo preço soma na mesma
// linha de venda em vez de criar uma nova. Cada ação devolve os "movimentos"
// exatos que fez -- é o que o "Desfazer" (undoVariantMovements) reverte.

export interface VariantRef {
  partnerId: string
  productId: string
  colorComboKey: string | null
}

export type VariantMovement =
  | { kind: 'sale'; reportId: string; delta: number; created: boolean }
  | { kind: 'return'; deliveryId: string; delta: number; previousLastReturnedAt: string | null }

type MovementResult = { success: boolean; error?: string; movements?: VariantMovement[]; units?: number }

function refresh() {
  revalidatePath('/consignment/partners')
  revalidatePath('/consignment/deliveries')
  revalidatePath('/consignment/reports')
  revalidatePath('/stock')
  revalidatePath('/dashboard')
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

async function variantDeliveries(ref: VariantRef) {
  const deliveries = await prisma.consignmentDelivery.findMany({
    where: {
      partnerId: ref.partnerId,
      productId: ref.productId,
      ...(ref.colorComboKey ? { colorComboKey: ref.colorComboKey } : { OR: [{ colorComboKey: null }, { colorComboKey: '' }] }),
    },
    include: { saleReports: true },
    orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
  })
  return deliveries.map((d) => ({
    delivery: d,
    remaining: Math.max(0, d.quantityDelivered - d.saleReports.reduce((sum, r) => sum + r.quantitySold, 0) - d.returnedQuantity),
  }))
}

export async function sellVariantUnits(ref: VariantRef, quantity = 1): Promise<MovementResult> {
  if (!Number.isInteger(quantity) || quantity < 1) return { success: false, error: 'Quantidade inválida.' }
  const [partner, lines] = await Promise.all([
    prisma.consignmentPartner.findUnique({ where: { id: ref.partnerId } }),
    variantDeliveries(ref),
  ])
  if (!partner) return { success: false, error: 'Parceiro não encontrado.' }
  const withBalance = lines.filter((l) => l.remaining > 0)
  const available = withBalance.reduce((sum, l) => sum + l.remaining, 0)
  if (available < quantity) return { success: false, error: `Ela só tem ${available} dessa variação.` }

  // Preço da linha = o da entrega mais recente que ainda tem saldo.
  const price = withBalance[withBalance.length - 1].delivery.unitPrice.toNumber()
  const commission = partner.defaultCommissionPercent.toNumber()
  const now = new Date()
  const movements: VariantMovement[] = []

  await prisma.$transaction(async (tx) => {
    let left = quantity
    for (const { delivery, remaining } of withBalance) {
      if (left <= 0) break
      const take = Math.min(left, remaining)
      const mergeable = delivery.saleReports.find(
        (r) => sameDay(r.reportDate, now) && Math.abs(r.commissionPercent.toNumber() - commission) < 1e-9 && Math.abs((r.unitPrice ?? delivery.unitPrice).toNumber() - price) < 0.005,
      )
      if (mergeable) {
        await tx.consignmentSaleReport.update({ where: { id: mergeable.id }, data: { quantitySold: { increment: take } } })
        movements.push({ kind: 'sale', reportId: mergeable.id, delta: take, created: false })
      } else {
        const created = await tx.consignmentSaleReport.create({
          data: { deliveryId: delivery.id, quantitySold: take, reportDate: now, commissionPercent: commission, unitPrice: price },
        })
        movements.push({ kind: 'sale', reportId: created.id, delta: take, created: true })
      }
      left -= take
    }
  })
  refresh()
  return { success: true, movements, units: quantity }
}

export async function returnVariantUnits(ref: VariantRef, quantity = 1): Promise<MovementResult> {
  if (!Number.isInteger(quantity) || quantity < 1) return { success: false, error: 'Quantidade inválida.' }
  const lines = (await variantDeliveries(ref)).filter((l) => l.remaining > 0)
  const available = lines.reduce((sum, l) => sum + l.remaining, 0)
  if (available < quantity) return { success: false, error: `Ela só tem ${available} dessa variação.` }

  const movements: VariantMovement[] = []
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    let left = quantity
    for (const { delivery, remaining } of lines) {
      if (left <= 0) break
      const take = Math.min(left, remaining)
      await tx.consignmentDelivery.update({ where: { id: delivery.id }, data: { returnedQuantity: { increment: take }, lastReturnedAt: now } })
      movements.push({ kind: 'return', deliveryId: delivery.id, delta: take, previousLastReturnedAt: delivery.lastReturnedAt?.toISOString() ?? null })
      left -= take
    }
  })
  refresh()
  return { success: true, movements, units: quantity }
}

// Desfaz exatamente o que as ações acima fizeram (e nada além).
export async function undoVariantMovements(movements: VariantMovement[]): Promise<{ success: boolean; error?: string }> {
  await prisma.$transaction(async (tx) => {
    for (const m of movements) {
      if (m.kind === 'sale') {
        const report = await tx.consignmentSaleReport.findUnique({ where: { id: m.reportId } })
        if (!report) continue
        if (m.created || report.quantitySold - m.delta <= 0) await tx.consignmentSaleReport.delete({ where: { id: m.reportId } })
        else await tx.consignmentSaleReport.update({ where: { id: m.reportId }, data: { quantitySold: { decrement: m.delta } } })
      } else {
        const delivery = await tx.consignmentDelivery.findUnique({ where: { id: m.deliveryId } })
        if (!delivery) continue
        const next = Math.max(0, delivery.returnedQuantity - m.delta)
        await tx.consignmentDelivery.update({
          where: { id: m.deliveryId },
          data: { returnedQuantity: next, lastReturnedAt: next === 0 ? null : (m.previousLastReturnedAt ? new Date(m.previousLastReturnedAt) : delivery.lastReturnedAt) },
        })
      }
    }
  })
  refresh()
  return { success: true }
}

// Preço da variação com ela: muda o preço de referência das entregas que
// ainda têm saldo (vale para as PRÓXIMAS vendas -- venda já registrada guarda o
// próprio preço). Devolve os preços antigos pro "Desfazer".
export async function setVariantUnitPrice(ref: VariantRef, price: number): Promise<{ success: boolean; error?: string; previous?: { deliveryId: string; unitPrice: number }[] }> {
  if (!(price > 0)) return { success: false, error: 'Informe um preço maior que zero.' }
  const lines = (await variantDeliveries(ref)).filter((l) => l.remaining > 0)
  if (lines.length === 0) return { success: false, error: 'Ela não tem essa variação.' }
  const previous = lines.map((l) => ({ deliveryId: l.delivery.id, unitPrice: l.delivery.unitPrice.toNumber() }))
  await prisma.consignmentDelivery.updateMany({ where: { id: { in: lines.map((l) => l.delivery.id) } }, data: { unitPrice: price } })
  refresh()
  return { success: true, previous }
}

export async function restoreDeliveryPrices(previous: { deliveryId: string; unitPrice: number }[]): Promise<{ success: boolean }> {
  await prisma.$transaction(previous.map((p) => prisma.consignmentDelivery.update({ where: { id: p.deliveryId }, data: { unitPrice: p.unitPrice } })))
  refresh()
  return { success: true }
}
