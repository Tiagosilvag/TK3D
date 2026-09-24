'use server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { orderSchema, orderStatusEnum } from '@/lib/validation/order'
import { getProductCostBreakdown } from '@/actions/products'
import { consumePackagingForSale } from '@/actions/sales'
import { resolveSalePlatformFee } from '@/actions/marketplacePlatforms'
import { buildSaleCostSnapshot } from '@/lib/costing'
import { productNeedsAssembly } from '@/lib/products'
import { getAssemblyStatus, type AssemblyPartColorOption } from '@/actions/assembly'
import { serializeColorChoices, deserializeColorChoices } from '@/lib/reports'
import { reconcileOrderReservations, reconcileAllPendingOrders, type OrderReallocationEvent } from '@/lib/orderReservations'
import { revalidatePath } from 'next/cache'
import type { Prisma, OrderChannel, OrderStatus, SaleChannel } from '@prisma/client'

type ActionResult = { success: boolean; error?: string; reallocations?: OrderReallocationEvent[] }

function parse(formData: FormData, colorComboKeyOverride?: string) {
  const raw = Object.fromEntries(formData)
  return orderSchema.safeParse({
    ...raw,
    colorComboKey: colorComboKeyOverride ?? raw.colorComboKey ?? null,
    buyerOrPlatform: raw.buyerOrPlatform || null,
    orderNumber: raw.orderNumber || null,
    notes: raw.notes || null,
  })
}

export interface OrderablePartOption {
  partId: string
  partName: string
  // Receita fixa (2+ ProductPartFilament): cor não é escolha do pedido --
  // fixedLabel mostra a combinação travada, colorOptions vem vazio.
  fixed: boolean
  fixedLabel: string | null
  colorOptions: AssemblyPartColorOption[]
}

// Encomenda com variação personalizada: opções de cor por peça pro
// seletor de Pedidos -- ao contrário de AssemblyPartColorOption puro
// (getAssemblyStatus), que só lista combo JÁ produzido alguma vez, aqui
// toda peça de cor variável (1 só ProductPartFilament) ganha o CATÁLOGO
// INTEIRO de filamento como opção (available: 0 pra cor nunca impressa
// pra essa peça) -- só assim dá pra pedir algo nunca produzido antes.
// Cobre também a "peça sintética" de produto simples com insumo/
// acessório (mesma convenção de getAssemblyStatus: key = productId).
export async function getOrderablePartOptions(productId: string): Promise<OrderablePartOption[]> {
  const [status, parts, filaments] = await Promise.all([
    getAssemblyStatus(productId),
    prisma.productPart.findMany({ where: { productId }, include: { filamentComponents: { include: { filament: true } } } }),
    prisma.filament.findMany({ orderBy: { colorName: 'asc' } }),
  ])

  const partById = new Map(parts.map((p) => [p.id, p]))

  return status.parts.map((partStatus): OrderablePartOption => {
    const part = partById.get(partStatus.partId)
    // Peça sintética (produto simples com insumo/acessório): sem
    // ProductPart real, sempre cor variável (mesmo tratamento de
    // getAssemblyStatus pro caso !isComposite).
    const isFixedRecipe = part ? part.filamentComponents.length >= 2 : false

    if (isFixedRecipe) {
      const label = part!.filamentComponents.map((c) => c.filament.colorName).join(' + ')
      return { partId: partStatus.partId, partName: partStatus.name, fixed: true, fixedLabel: label, colorOptions: [] }
    }

    const existing = new Map((partStatus.colorOptions ?? []).map((o) => [o.key, o]))
    const merged: AssemblyPartColorOption[] = filaments.map((f) => {
      const found = existing.get(f.id)
      return found ?? { key: f.id, filamentIds: [f.id], label: f.colorName, available: 0, colorHex: f.colorHex }
    })
    // Combo multi-filamento já produzido pra essa peça (não corresponde a
    // nenhum Filament.id sozinho) -- mantém como opção também, senão uma
    // cor já montada/produzida some do seletor.
    for (const o of existing.values()) {
      if (!merged.some((m) => m.key === o.key)) merged.push(o)
    }

    return { partId: partStatus.partId, partName: partStatus.name, fixed: false, fixedLabel: null, colorOptions: merged }
  })
}

// Melhoria "Pedidos com reserva de estoque": depois de criar o pedido,
// tenta reservar do estoque disponível na hora (reconcileOrderReservations
// recalcula a fila inteira daquele produto+variação, do zero, por
// prioridade de prazo) -- se isso tomar peça de outro pedido que já
// tinha reserva (só acontece quando o pedido novo é mais urgente que um
// já reservado), os eventos voltam no ActionResult pro form mostrar o
// aviso passageiro (só existe aqui -- produção/montagem nunca "roubam"
// reserva de ninguém, só preenchem buraco, ver lib/orderReservations.ts).
// Encomenda com variação personalizada: quando o formulário manda
// colorChoicesJson ({ partId: filamentId }, do CustomVariantPicker),
// revalida contra as peças REAIS do produto (nunca confia cegamente no
// client) antes de virar colorComboKey -- toda peça citada precisa
// existir, ser de cor variável (não receita fixa) e apontar pra um
// filamento que existe. Cálculo de serializeColorChoices fica sempre no
// servidor (nunca no client, que não importa lib/reports.ts -- é
// server-only, usa Prisma).
async function resolveCustomColorComboKey(productId: string, colorChoicesJson: string): Promise<{ colorComboKey: string } | { error: string }> {
  let raw: unknown
  try {
    raw = JSON.parse(colorChoicesJson)
  } catch {
    return { error: 'Combinação de cor inválida' }
  }
  const choicesParsed = z.record(z.string(), z.string()).safeParse(raw)
  if (!choicesParsed.success) return { error: 'Combinação de cor inválida' }
  const choices = choicesParsed.data

  const options = await getOrderablePartOptions(productId)
  const optionByPart = new Map(options.map((o) => [o.partId, o]))
  for (const [partId, filamentId] of Object.entries(choices)) {
    const option = optionByPart.get(partId)
    if (!option) return { error: 'Peça inválida na combinação de cor' }
    if (option.fixed) return { error: `${option.partName} tem receita fixa -- não é uma cor escolhível` }
    if (!option.colorOptions.some((o) => o.key === filamentId)) return { error: `Cor inválida pra ${option.partName}` }
  }
  // Toda peça de cor variável do produto precisa ter uma escolha --
  // senão a combinação fica incompleta (peça sem cor definida).
  for (const option of options) {
    if (!option.fixed && !(option.partId in choices)) return { error: `Falta escolher a cor de ${option.partName}` }
  }

  return { colorComboKey: serializeColorChoices(choices) }
}

export async function createOrder(formData: FormData): Promise<ActionResult> {
  const colorChoicesJson = formData.get('colorChoicesJson')
  let colorComboKeyOverride: string | undefined
  if (typeof colorChoicesJson === 'string' && colorChoicesJson) {
    const productId = String(formData.get('productId') ?? '')
    const resolved = await resolveCustomColorComboKey(productId, colorChoicesJson)
    if ('error' in resolved) return { success: false, error: resolved.error }
    colorComboKeyOverride = resolved.colorComboKey
  }

  const parsed = parse(formData, colorComboKeyOverride)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const order = await prisma.order.create({ data: parsed.data })
  const reallocations = await reconcileOrderReservations(order.productId, order.colorComboKey)
  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Direta -> venda Direta; Shopee/Mercado Livre -> venda Marketplace (o
// enum de Sale só distingue esses dois grandes grupos) -- o nome exato da
// plataforma vai pro campo Comprador/Plataforma da Sale, então a
// informação não se perde mesmo sem 4.1 (plataformas configuráveis) ainda
// existir.
const ORDER_CHANNEL_TO_SALE_CHANNEL: Record<OrderChannel, SaleChannel> = {
  DIRETA: 'DIRETA',
  SHOPEE: 'MARKETPLACE',
  MERCADO_LIVRE: 'MARKETPLACE',
}
const ORDER_CHANNEL_PLATFORM_LABEL: Record<OrderChannel, string> = {
  DIRETA: 'Direta',
  SHOPEE: 'Shopee',
  MERCADO_LIVRE: 'Mercado Livre',
}

const updateStatusSchema = z.object({ status: orderStatusEnum })

// Muda o status do pedido; ao chegar em ENTREGUE pela primeira vez (nunca
// se já tiver saleId -- idempotente contra clique duplo/reentrada), cria a
// Sale correspondente com o costSnapshot já congelado (mesmo padrão de
// createSale em actions/sales.ts) e vincula via Order.saleId. "Dar baixa
// no estoque" continua sendo só essa Sale entrando na conta de
// getOwnStockSummary -- sem contador separado. Melhoria "Pedidos com
// reserva de estoque": ENTREGUE assumiu o papel que CONCLUIDO tinha (esse
// último vira legado, nunca mais escrito); os status intermediários
// (AGUARDANDO_PRODUCAO/PARCIAL_.../AGUARDANDO_MONTAGEM/PRONTO_RESERVADO)
// não são mais setados por aqui -- são derivados por
// reconcileOrderReservations, a UI só mostra (ver OrderStatusForm.tsx).
export async function updateOrderStatus(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = updateStatusSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const order = await prisma.order.findUniqueOrThrow({ where: { id } })

  if (parsed.data.status !== 'ENTREGUE' || order.saleId) {
    await prisma.order.update({ where: { id }, data: { status: parsed.data.status } })
    revalidatePath('/orders')
    return { success: true }
  }

  const breakdown = await getProductCostBreakdown(order.productId)
  const saleChannel = ORDER_CHANNEL_TO_SALE_CHANNEL[order.channel]
  const platformFee = await resolveSalePlatformFee(saleChannel, order.unitPrice.toNumber(), order.productId)
  const snapshot = buildSaleCostSnapshot(
    breakdown,
    order.quantity,
    platformFee ? { feePercent: platformFee.feePercent, feeFixed: platformFee.feeFixed, amountTotal: platformFee.feeAmountPerUnit * order.quantity } : undefined,
  )

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        channel: saleChannel,
        productId: order.productId,
        colorComboKey: order.colorComboKey,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        saleDate: new Date(),
        buyerOrPlatform: order.buyerOrPlatform ?? ORDER_CHANNEL_PLATFORM_LABEL[order.channel],
        notes: order.orderNumber ? `Pedido #${order.orderNumber}` : null,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        // Melhoria "Vendas: múltiplos produtos numa venda": Sale.batchId é
        // NOT NULL -- pedido concluído sempre vira uma venda de 1 item só,
        // então recebe seu próprio lote (mesmo raciocínio de createSale).
        batchId: randomUUID(),
      },
    })
    await tx.order.update({ where: { id }, data: { status: 'ENTREGUE', saleId: sale.id } })
    // Melhoria "Histórico de consumo": mesmo consumo de embalagem que
    // createSale aplica (actions/sales.ts) -- pedido concluído vira Sale
    // aqui direto (nunca chama createSale), então precisa do mesmo passo.
    await consumePackagingForSale(tx, sale.id, order.productId, order.quantity)
  })

  // ENTREGUE é terminal -- sai da conta de "reservado", reconcilia pra
  // dar a próxima peça (se sobrar alguma, o que não deveria acontecer já
  // que este pedido só chega aqui com reservedQuantity == quantity, mas
  // roda mesmo assim por segurança/consistência).
  await reconcileOrderReservations(order.productId, order.colorComboKey)

  revalidatePath('/orders')
  revalidatePath('/sales')
  revalidatePath('/stock')
  revalidatePath('/packaging')
  return { success: true }
}

// Melhoria "Pedidos com reserva de estoque": cancelar é diferente de
// excluir -- o pedido continua existindo (histórico), só vira terminal
// (CANCELADO) e sai da conta de "reservado"/fila de demanda.
// reservedQuantity NÃO é zerado (fica como registro do que este pedido
// chegou a ter, mesma filosofia de nunca reescrever fato passado --
// costSnapshot é o precedente) -- quem muda é a exclusão de CANCELADO da
// soma de "reservado" em lib/reports.ts, então a peça já volta a contar
// como Disponível sem precisar apagar nada; reconcileOrderReservations
// roda em seguida pra dar a peça liberada pro próximo pedido da fila.
export async function cancelOrder(id: string): Promise<ActionResult> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id } })
  if (order.saleId) {
    return { success: false, error: 'Este pedido já foi entregue e virou uma venda — cancele a venda em Vendas, se necessário.' }
  }
  await prisma.order.update({ where: { id }, data: { status: 'CANCELADO' } })
  const reallocations = await reconcileOrderReservations(order.productId, order.colorComboKey)
  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Só pedidos ainda não entregues podem ser removidos -- uma vez com Sale
// vinculada, a Sale é o registro real da transação (deleteSale, se for o
// caso, já existe em actions/sales.ts).
export async function deleteOrder(id: string): Promise<ActionResult> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id } })
  if (order.saleId) {
    return { success: false, error: 'Este pedido já foi entregue e virou uma venda — remova a venda em Vendas, se necessário.' }
  }
  await prisma.order.delete({ where: { id } })
  await reconcileOrderReservations(order.productId, order.colorComboKey)
  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true }
}

// Melhoria "Fila de demanda em Produção/Montagem": 1 linha por (pedido,
// peça-ou-produto) que ainda falta pra fechar aquele pedido -- só pedido
// não-terminal com quantity > reservedQuantity entra aqui. Produto sem
// componente nenhum (não precisa de montagem) só pode faltar "produzir o
// produto direto" -- entra em productionRows. Produto que precisa de
// montagem quebra o que falta em, por peça: quanto dá pra cobrir com peça
// JÁ produzida esperando montagem (assemblyRows) e quanto ainda falta
// produzir de cada peça (productionRows) -- reivindicando de um "pool"
// corrido por peça (inicializado do que getAssemblyStatus reporta como
// disponível agora), na mesma ordem de prioridade por prazo que
// reconcileOrderReservations usa pra reserva de verdade, pra não
// superestimar quando 2+ pedidos disputam a mesma peça na exibição.
export interface OrderDemandRow {
  orderId: string
  orderNumber: string | null
  channel: OrderChannel
  buyerOrPlatform: string | null
  deliveryDate: Date
  status: OrderStatus
  productId: string
  productName: string
  partId: string | null
  partName: string | null
  neededUnits: number
  reservedQuantity: number
  quantity: number
  // Encomenda com variação personalizada: colorComboKey inteiro do
  // pedido (todas as peças), pra Montagem pré-selecionar a combinação
  // certa; comboLabel/filamentIds são só da PEÇA desta linha (produção
  // só imprime uma peça por vez), null quando o pedido não tem cor
  // específica ou a peça é receita fixa.
  colorComboKey: string | null
  comboLabel: string | null
  filamentIds: string[] | null
}

export async function getOrderDemandQueue(): Promise<{ productionRows: OrderDemandRow[]; assemblyRows: OrderDemandRow[] }> {
  const orders = await prisma.order.findMany({
    where: { status: { notIn: ['ENTREGUE', 'CANCELADO'] } },
    include: { product: { include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } } } },
    orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
  })
  const pending = orders.filter((o) => o.quantity > o.reservedQuantity)
  if (pending.length === 0) return { productionRows: [], assemblyRows: [] }

  const productionRows: OrderDemandRow[] = []
  const assemblyRows: OrderDemandRow[] = []
  type ProductCache = {
    parts: Awaited<ReturnType<typeof getAssemblyStatus>>['parts']
    pool: Map<string, number>
    comboPools: Map<string, Map<string, number>>
  }
  const cacheByProduct = new Map<string, ProductCache>()
  // Encomenda com variação personalizada: uma linha de PRODUÇÃO existe
  // exatamente pra uma cor que ainda falta imprimir -- então
  // status.parts[].colorOptions (só lista combo JÁ produzido alguma vez,
  // getAssemblyStatus) nunca vai ter o rótulo dela. Pra peça de cor
  // variável, o combo escolhido no pedido é sempre 1 filamentId sozinho
  // (resolveCustomColorComboKey só aceita escolha assim), então dá pra
  // resolver o rótulo direto no catálogo -- carregado uma vez só, sob
  // demanda (nenhuma linha com colorComboKey, nenhuma query).
  let filamentById: Map<string, { colorName: string }> | null = null
  async function getFilamentLabel(filamentId: string): Promise<string | null> {
    if (!filamentById) {
      const all = await prisma.filament.findMany({ select: { id: true, colorName: true } })
      filamentById = new Map(all.map((f) => [f.id, { colorName: f.colorName }]))
    }
    return filamentById.get(filamentId)?.colorName ?? null
  }

  for (const order of pending) {
    const shortfall = order.quantity - order.reservedQuantity
    const product = order.product
    const base = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: order.channel,
      buyerOrPlatform: order.buyerOrPlatform,
      deliveryDate: order.deliveryDate,
      status: order.status,
      productId: product.id,
      productName: product.name,
      reservedQuantity: order.reservedQuantity,
      quantity: order.quantity,
      colorComboKey: order.colorComboKey,
    }

    const needsAssembly = productNeedsAssembly({
      isComposite: product.isComposite,
      accessoryUsagesCount: product._count.accessoryUsages,
      supplyUsagesCount: product._count.supplyUsages,
      componentUsagesCount: product._count.componentUsages,
    })

    if (!needsAssembly) {
      productionRows.push({ ...base, partId: null, partName: null, neededUnits: shortfall, comboLabel: null, filamentIds: null })
      continue
    }

    if (!cacheByProduct.has(product.id)) {
      const status = await getAssemblyStatus(product.id)
      const pool = new Map<string, number>()
      const comboPools = new Map<string, Map<string, number>>()
      for (const part of status.parts) {
        pool.set(part.partId, part.available)
        if (part.colorOptions && part.colorOptions.length > 0) {
          comboPools.set(part.partId, new Map(part.colorOptions.map((o) => [o.key, o.available])))
        }
      }
      cacheByProduct.set(product.id, { parts: status.parts, pool, comboPools })
    }
    const { parts, pool, comboPools } = cacheByProduct.get(product.id)!

    // Encomenda com variação personalizada: pedido com colorComboKey só
    // reivindica a fatia do combo que ELE pediu (nunca a soma de todas
    // as cores da peça); pedido sem variante continua reivindicando o
    // pool agregado de sempre, drenando de qualquer combo (não importa
    // a cor pra ele) -- mantém os dois tipos de pedido consumindo do
    // MESMO estoque físico subjacente, sem contar a peça duas vezes.
    const choices = order.colorComboKey ? deserializeColorChoices(order.colorComboKey) : null

    function availableForPart(partId: string): number {
      const combos = comboPools.get(partId)
      if (choices && combos) return combos.get(choices[partId] ?? '') ?? 0
      return pool.get(partId) ?? 0
    }

    function consumeFromPart(partId: string, units: number): void {
      pool.set(partId, (pool.get(partId) ?? 0) - units)
      const combos = comboPools.get(partId)
      if (!combos) return
      if (choices) {
        const key = choices[partId]
        if (key !== undefined) combos.set(key, (combos.get(key) ?? 0) - units)
        return
      }
      let remaining = units
      for (const [k, v] of combos) {
        if (remaining <= 0) break
        const take = Math.min(v, remaining)
        combos.set(k, v - take)
        remaining -= take
      }
    }

    async function comboInfoForPart(partId: string): Promise<{ comboLabel: string | null; filamentIds: string[] | null }> {
      if (!choices) return { comboLabel: null, filamentIds: null }
      const chosenKey = choices[partId]
      if (chosenKey === undefined) return { comboLabel: null, filamentIds: null }
      const part = parts.find((p) => p.partId === partId)
      const option = part?.colorOptions?.find((o) => o.key === chosenKey)
      if (option) return { comboLabel: option.label, filamentIds: option.filamentIds }
      // Cor nunca produzida pra essa peça -- sem entrada em colorOptions
      // (produced-only). O combo de um pedido é sempre 1 filamentId
      // sozinho pra peça de cor variável, então resolve pelo catálogo.
      const label = await getFilamentLabel(chosenKey)
      return label ? { comboLabel: label, filamentIds: [chosenKey] } : { comboLabel: null, filamentIds: null }
    }

    let assemblableUnits = shortfall
    for (const part of parts) {
      const poolAvail = availableForPart(part.partId)
      const unitsFromThisPart = part.quantityPerUnit > 0 ? Math.floor(poolAvail / part.quantityPerUnit) : shortfall
      assemblableUnits = Math.min(assemblableUnits, unitsFromThisPart)
    }
    assemblableUnits = Math.max(0, assemblableUnits)

    if (assemblableUnits > 0) {
      assemblyRows.push({ ...base, partId: null, partName: null, neededUnits: assemblableUnits, comboLabel: null, filamentIds: null })
      for (const part of parts) {
        consumeFromPart(part.partId, assemblableUnits * part.quantityPerUnit)
      }
    }

    const remaining = shortfall - assemblableUnits
    if (remaining > 0) {
      for (const part of parts) {
        const neededForPart = remaining * part.quantityPerUnit
        const poolAvail = Math.max(0, availableForPart(part.partId))
        const stillMissing = Math.max(0, neededForPart - poolAvail)
        consumeFromPart(part.partId, Math.min(poolAvail, neededForPart))
        if (stillMissing > 0) {
          productionRows.push({ ...base, partId: part.partId, partName: part.name, neededUnits: stillMissing, ...(await comboInfoForPart(part.partId)) })
        }
      }
    }
  }

  return { productionRows, assemblyRows }
}

// Bug "pedido antigo fica travado mostrando falta produzir pra sempre":
// botão manual (DemandQueuePanel) pra varrer e reconciliar TODO pedido
// pendente de uma vez -- corrige pedidos cuja reconciliação deveria ter
// rodado num evento passado mas ficou pra trás (ex.: criados antes de um
// fix de escopo de reconciliação), sem precisar esperar outro evento do
// mesmo produto+combo disparar por acaso.
export async function syncOrderReservations(): Promise<ActionResult> {
  await reconcileAllPendingOrders()
  revalidatePath('/orders')
  revalidatePath('/production')
  revalidatePath('/assembly')
  revalidatePath('/stock')
  return { success: true }
}
