'use server'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { getProductVariantStockOptions } from '@/lib/reports'

// Movimentos da parceira (entregas, vendas, devoluções, pagamentos) editáveis.
// Toda mudança roda numa transação: aplica, redistribui o que passou da
// capacidade de cada linha de entrega, RECALCULA e recusa (desfazendo tudo)
// se alguma variação ficar com "com ela" negativo ou se os pagamentos
// passarem da comissão. Devolve um retrato dos registros de antes
// (`snapshot`), que é o que o "Desfazer" restaura.

type Tx = Prisma.TransactionClient

export interface LedgerSnapshot {
  deliveries: {
    id: string; batchId: string; partnerId: string; productId: string; quantityDelivered: number; unitPrice: number
    deliveryDate: string; colorComboKey: string | null; notes: string | null; returnedQuantity: number; lastReturnedAt: string | null
  }[]
  reports: { id: string; deliveryId: string; quantitySold: number; reportDate: string; commissionPercent: number; unitPrice: number | null; notes: string | null }[]
  payments: { id: string; partnerId: string; amount: number; paidAt: string; notes: string | null }[]
}

export type LedgerOp =
  | { type: 'delivery'; id: string; quantity?: number; unitPrice?: number; date?: string }
  | { type: 'deliveryDate'; batchId: string; date: string }
  | { type: 'sale'; id: string; quantity?: number; unitPrice?: number; commissionPercent?: number; date?: string }
  | { type: 'return'; deliveryId: string; quantity: number; date?: string }
  | { type: 'payment'; id: string; amount?: number; date?: string }

export type LedgerResult = { success: boolean; error?: string; snapshot?: LedgerSnapshot }

class LedgerError extends Error {}

const money = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`
const varKey = (productId: string, key: string | null) => `${productId}::${key ?? ''}`
const parseDay = (s: string) => {
  const d = new Date(`${s}T12:00:00`)
  if (Number.isNaN(d.getTime())) throw new LedgerError('Data inválida.')
  return d
}

async function takeSnapshot(tx: Tx, partnerId: string): Promise<LedgerSnapshot> {
  const [deliveries, payments] = await Promise.all([
    tx.consignmentDelivery.findMany({ where: { partnerId }, include: { saleReports: true } }),
    tx.consignmentPartnerPayment.findMany({ where: { partnerId } }),
  ])
  return {
    deliveries: deliveries.map((d) => ({
      id: d.id, batchId: d.batchId, partnerId: d.partnerId, productId: d.productId, quantityDelivered: d.quantityDelivered,
      unitPrice: d.unitPrice.toNumber(), deliveryDate: d.deliveryDate.toISOString(), colorComboKey: d.colorComboKey, notes: d.notes,
      returnedQuantity: d.returnedQuantity, lastReturnedAt: d.lastReturnedAt?.toISOString() ?? null,
    })),
    reports: deliveries.flatMap((d) => d.saleReports.map((r) => ({
      id: r.id, deliveryId: r.deliveryId, quantitySold: r.quantitySold, reportDate: r.reportDate.toISOString(),
      commissionPercent: r.commissionPercent.toNumber(), unitPrice: r.unitPrice?.toNumber() ?? null, notes: r.notes,
    }))),
    payments: payments.map((p) => ({ id: p.id, partnerId: p.partnerId, amount: p.amount.toNumber(), paidAt: p.paidAt.toISOString(), notes: p.notes })),
  }
}

// Linhas de entrega da mesma variação: o que passou da capacidade (vendido +
// devolvido > entregue) vai para linhas com folga, dividindo a venda se
// preciso. O total da variação não muda -- só a atribuição entre linhas.
async function rebalanceVariation(tx: Tx, partnerId: string, productId: string, colorComboKey: string | null) {
  const rows = await tx.consignmentDelivery.findMany({
    where: { partnerId, productId, ...(colorComboKey ? { colorComboKey } : { OR: [{ colorComboKey: null }, { colorComboKey: '' }] }) },
    include: { saleReports: { orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }] } },
    orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
  })
  const state = rows.map((d) => ({
    id: d.id,
    delivered: d.quantityDelivered,
    returned: d.returnedQuantity,
    reports: d.saleReports.map((r) => ({ id: r.id, qty: r.quantitySold })),
  }))
  const used = (r: (typeof state)[number]) => r.returned + r.reports.reduce((s, x) => s + x.qty, 0)

  for (const row of state) {
    let over = used(row) - row.delivered
    if (over <= 0) continue
    for (const target of state) {
      if (over <= 0) break
      if (target === row) continue
      let spare = target.delivered - used(target)
      if (spare <= 0) continue
      // 1º devolvidos (só um contador), depois as vendas mais recentes.
      const moveReturned = Math.min(over, spare, row.returned)
      if (moveReturned > 0) {
        row.returned -= moveReturned
        target.returned += moveReturned
        over -= moveReturned
        spare -= moveReturned
        await tx.consignmentDelivery.update({ where: { id: row.id }, data: { returnedQuantity: row.returned } })
        await tx.consignmentDelivery.update({ where: { id: target.id }, data: { returnedQuantity: target.returned, lastReturnedAt: new Date() } })
      }
      for (const report of [...row.reports]) {
        if (over <= 0 || spare <= 0) break
        const take = Math.min(over, spare, report.qty)
        if (take <= 0) continue
        if (take === report.qty) {
          await tx.consignmentSaleReport.update({ where: { id: report.id }, data: { deliveryId: target.id } })
          row.reports = row.reports.filter((x) => x !== report)
          target.reports.push(report)
        } else {
          const full = await tx.consignmentSaleReport.findUniqueOrThrow({ where: { id: report.id } })
          await tx.consignmentSaleReport.update({ where: { id: report.id }, data: { quantitySold: report.qty - take } })
          const clone = await tx.consignmentSaleReport.create({
            data: { deliveryId: target.id, quantitySold: take, reportDate: full.reportDate, commissionPercent: full.commissionPercent, unitPrice: full.unitPrice, notes: full.notes },
          })
          report.qty -= take
          target.reports.push({ id: clone.id, qty: take })
        }
        over -= take
        spare -= take
      }
    }
  }
}

// Depois de aplicar: nenhuma variação com "com ela" negativo e nenhuma linha
// ainda acima da capacidade; pagamentos não passam da comissão.
async function validate(tx: Tx, partnerId: string, touched: Set<string>) {
  const deliveries = await tx.consignmentDelivery.findMany({ where: { partnerId }, include: { product: { select: { name: true } }, saleReports: true } })
  const byVariation = new Map<string, { name: string; delivered: number; used: number }>()
  let commission = 0
  for (const d of deliveries) {
    const key = varKey(d.productId, d.colorComboKey)
    const entry = byVariation.get(key) ?? { name: d.product.name, delivered: 0, used: 0 }
    const sold = d.saleReports.reduce((s, r) => s + r.quantitySold, 0)
    entry.delivered += d.quantityDelivered
    entry.used += sold + d.returnedQuantity
    byVariation.set(key, entry)
    for (const r of d.saleReports) commission += r.quantitySold * (r.unitPrice ?? d.unitPrice).toNumber() * r.commissionPercent.toNumber()
  }
  for (const [key, v] of byVariation) {
    // Só as variações mexidas: dado antigo inconsistente não trava edição alheia.
    if (touched.has(key) && v.used > v.delivered) {
      throw new LedgerError(`${v.name}: ela ficaria com ${v.delivered - v.used} (já vendeu ou devolveu ${v.used} de ${v.delivered} entregues).`)
    }
  }
  const paid = (await tx.consignmentPartnerPayment.aggregate({ where: { partnerId }, _sum: { amount: true } }))._sum.amount?.toNumber() ?? 0
  if (paid > Math.round(commission * 100) / 100 + 0.005) {
    throw new LedgerError(`Os pagamentos (${money(paid)}) passariam da comissão total (${money(commission)}).`)
  }
}

function refresh() {
  revalidatePath('/consignment/partners')
  revalidatePath('/consignment/deliveries')
  revalidatePath('/consignment/reports')
  revalidatePath('/stock')
  revalidatePath('/dashboard')
}

export async function editPartnerLedger(partnerId: string, op: LedgerOp): Promise<LedgerResult> {
  try {
    // Seu saldo: aumentar uma entrega só até o que você tem montado/livre.
    let stockCheck: { productId: string; key: string; increase: number; name: string } | null = null
    if (op.type === 'delivery' && op.quantity !== undefined) {
      const d = await prisma.consignmentDelivery.findUnique({ where: { id: op.id }, include: { product: { select: { name: true } } } })
      if (d && d.colorComboKey && op.quantity > d.quantityDelivered) {
        stockCheck = { productId: d.productId, key: d.colorComboKey, increase: op.quantity - d.quantityDelivered, name: d.product.name }
      }
    }
    if (stockCheck) {
      const options = await getProductVariantStockOptions()
      const variant = options.find((p) => p.productId === stockCheck!.productId)?.variants.find((v) => v.key === stockCheck!.key)
      if (variant && stockCheck.increase > variant.available) {
        return { success: false, error: `${stockCheck.name}: seu estoque livre dessa variação é ${variant.available}; faltam ${stockCheck.increase - variant.available}.` }
      }
    }

    const snapshot = await prisma.$transaction(async (tx) => {
      const before = await takeSnapshot(tx, partnerId)
      const touched: { productId: string; key: string | null }[] = []
      let pendingDelete: string | null = null

      if (op.type === 'delivery') {
        const d = await tx.consignmentDelivery.findUnique({ where: { id: op.id }, include: { orderItem: { select: { id: true } } } })
        if (!d || d.partnerId !== partnerId) throw new LedgerError('Entrega não encontrada.')
        touched.push({ productId: d.productId, key: d.colorComboKey })
        if (op.quantity === 0) {
          if (d.orderItem) throw new LedgerError('Esta entrega veio de um pedido; desfaça a entrega em Pedidos.')
          // Esvazia a linha e deixa a redistribuição levar vendas/devoluções
          // para outras linhas da variação; só some se ficar vazia (senão a
          // validação recusa -- nunca apaga venda junto).
          await tx.consignmentDelivery.update({ where: { id: d.id }, data: { quantityDelivered: 0 } })
          pendingDelete = d.id
        } else {
          if (op.quantity !== undefined && (!Number.isInteger(op.quantity) || op.quantity < 0)) throw new LedgerError('Quantidade inválida.')
          if (op.unitPrice !== undefined && !(op.unitPrice > 0)) throw new LedgerError('Informe um preço maior que zero.')
          await tx.consignmentDelivery.update({
            where: { id: d.id },
            data: {
              ...(op.quantity !== undefined ? { quantityDelivered: op.quantity } : {}),
              ...(op.unitPrice !== undefined ? { unitPrice: op.unitPrice } : {}),
              ...(op.date ? { deliveryDate: parseDay(op.date) } : {}),
            },
          })
        }
      } else if (op.type === 'deliveryDate') {
        const rows = await tx.consignmentDelivery.findMany({ where: { batchId: op.batchId, partnerId } })
        if (rows.length === 0) throw new LedgerError('Entrega não encontrada.')
        await tx.consignmentDelivery.updateMany({ where: { batchId: op.batchId, partnerId }, data: { deliveryDate: parseDay(op.date) } })
      } else if (op.type === 'sale') {
        const r = await tx.consignmentSaleReport.findUnique({ where: { id: op.id }, include: { delivery: true } })
        if (!r || r.delivery.partnerId !== partnerId) throw new LedgerError('Venda não encontrada.')
        touched.push({ productId: r.delivery.productId, key: r.delivery.colorComboKey })
        if (op.quantity === 0) {
          await tx.consignmentSaleReport.delete({ where: { id: r.id } })
        } else {
          if (op.quantity !== undefined && (!Number.isInteger(op.quantity) || op.quantity < 0)) throw new LedgerError('Quantidade inválida.')
          if (op.unitPrice !== undefined && !(op.unitPrice > 0)) throw new LedgerError('Informe um preço maior que zero.')
          if (op.commissionPercent !== undefined && !(op.commissionPercent >= 0 && op.commissionPercent <= 1)) throw new LedgerError('Comissão inválida.')
          await tx.consignmentSaleReport.update({
            where: { id: r.id },
            data: {
              ...(op.quantity !== undefined ? { quantitySold: op.quantity } : {}),
              ...(op.unitPrice !== undefined ? { unitPrice: op.unitPrice } : {}),
              ...(op.commissionPercent !== undefined ? { commissionPercent: op.commissionPercent } : {}),
              ...(op.date ? { reportDate: parseDay(op.date) } : {}),
            },
          })
        }
      } else if (op.type === 'return') {
        const d = await tx.consignmentDelivery.findUnique({ where: { id: op.deliveryId } })
        if (!d || d.partnerId !== partnerId) throw new LedgerError('Entrega não encontrada.')
        if (!Number.isInteger(op.quantity) || op.quantity < 0) throw new LedgerError('Quantidade inválida.')
        touched.push({ productId: d.productId, key: d.colorComboKey })
        await tx.consignmentDelivery.update({
          where: { id: d.id },
          data: {
            returnedQuantity: op.quantity,
            lastReturnedAt: op.quantity === 0 ? null : op.date ? parseDay(op.date) : (d.lastReturnedAt ?? new Date()),
          },
        })
      } else {
        const p = await tx.consignmentPartnerPayment.findUnique({ where: { id: op.id } })
        if (!p || p.partnerId !== partnerId) throw new LedgerError('Pagamento não encontrado.')
        if (op.amount === 0) {
          await tx.consignmentPartnerPayment.delete({ where: { id: p.id } })
        } else {
          if (op.amount !== undefined && !(op.amount > 0)) throw new LedgerError('Informe um valor maior que zero.')
          await tx.consignmentPartnerPayment.update({
            where: { id: p.id },
            data: { ...(op.amount !== undefined ? { amount: Math.round(op.amount * 100) / 100 } : {}), ...(op.date ? { paidAt: parseDay(op.date) } : {}) },
          })
        }
      }

      for (const t of touched) await rebalanceVariation(tx, partnerId, t.productId, t.key)
      await validate(tx, partnerId, new Set(touched.map((t) => varKey(t.productId, t.key))))
      if (pendingDelete) await tx.consignmentDelivery.delete({ where: { id: pendingDelete } })
      return before
    })
    refresh()
    return { success: true, snapshot }
  } catch (err) {
    if (err instanceof LedgerError) return { success: false, error: err.message }
    throw err
  }
}

// "Desfazer": volta os registros da parceira ao retrato de antes da edição.
export async function restorePartnerLedger(partnerId: string, snapshot: LedgerSnapshot): Promise<{ success: boolean; error?: string }> {
  await prisma.$transaction(async (tx) => {
    const current = await takeSnapshot(tx, partnerId)
    const keepDeliveries = new Set(snapshot.deliveries.map((d) => d.id))
    const keepReports = new Set(snapshot.reports.map((r) => r.id))
    const keepPayments = new Set(snapshot.payments.map((p) => p.id))

    await tx.consignmentSaleReport.deleteMany({ where: { id: { in: current.reports.filter((r) => !keepReports.has(r.id)).map((r) => r.id) } } })
    await tx.consignmentPartnerPayment.deleteMany({ where: { id: { in: current.payments.filter((p) => !keepPayments.has(p.id)).map((p) => p.id) } } })
    await tx.consignmentDelivery.deleteMany({ where: { id: { in: current.deliveries.filter((d) => !keepDeliveries.has(d.id)).map((d) => d.id) } } })

    const existingDeliveries = new Set(current.deliveries.map((d) => d.id))
    for (const d of snapshot.deliveries) {
      const data = {
        batchId: d.batchId, partnerId: d.partnerId, productId: d.productId, quantityDelivered: d.quantityDelivered, unitPrice: d.unitPrice,
        deliveryDate: new Date(d.deliveryDate), colorComboKey: d.colorComboKey, notes: d.notes, returnedQuantity: d.returnedQuantity,
        lastReturnedAt: d.lastReturnedAt ? new Date(d.lastReturnedAt) : null,
      }
      if (existingDeliveries.has(d.id)) await tx.consignmentDelivery.update({ where: { id: d.id }, data })
      else await tx.consignmentDelivery.create({ data: { id: d.id, ...data } })
    }
    const existingReports = new Set(current.reports.map((r) => r.id))
    for (const r of snapshot.reports) {
      const data = { deliveryId: r.deliveryId, quantitySold: r.quantitySold, reportDate: new Date(r.reportDate), commissionPercent: r.commissionPercent, unitPrice: r.unitPrice, notes: r.notes }
      if (existingReports.has(r.id)) await tx.consignmentSaleReport.update({ where: { id: r.id }, data })
      else await tx.consignmentSaleReport.create({ data: { id: r.id, ...data } })
    }
    const existingPayments = new Set(current.payments.map((p) => p.id))
    for (const p of snapshot.payments) {
      const data = { partnerId: p.partnerId, amount: p.amount, paidAt: new Date(p.paidAt), notes: p.notes }
      if (existingPayments.has(p.id)) await tx.consignmentPartnerPayment.update({ where: { id: p.id }, data })
      else await tx.consignmentPartnerPayment.create({ data: { id: p.id, ...data } })
    }
  })
  refresh()
  return { success: true }
}
