'use server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { orderHeaderSchema, orderItemSchema, orderStatusEnum } from '@/lib/validation/order'
import { getProductCostBreakdown } from '@/actions/products'
import { consumePackagingForSale } from '@/actions/sales'
import { resolveSalePlatformFee } from '@/actions/marketplacePlatforms'
import { buildSaleCostSnapshot } from '@/lib/costing'
import { productNeedsAssembly } from '@/lib/products'
import { getAssemblyStatus, type AssemblyPartColorOption } from '@/actions/assembly'
import { serializeColorChoices, deserializeColorChoices } from '@/lib/reports'
import { reconcileOrderReservations, reconcileAllPendingOrders, type OrderReallocationEvent } from '@/lib/orderReservations'
import { areAllItemsTerminal, resolveNotificationsForResource } from '@/lib/notifications'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import type { OrderChannel, OrderStatus, SaleChannel } from '@prisma/client'

type ActionResult = { success: boolean; error?: string; reallocations?: OrderReallocationEvent[] }

// Bug "Excluir antes de Cancelar dá um bug": mesmo padrão de
// actions/accessories.ts/filaments.ts/supplies.ts/printers.ts pra FK
// RESTRICT -- ver comentário em deleteOrder abaixo.
function isForeignKeyConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003'
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
  // Bug "não fazia sentido pedir cor sem filamento em estoque": SÓ
  // filamento com currentStockGrams > 0 pode ser pedido aqui -- cor nunca
  // produzida (catálogo) OU já produzida antes, tanto faz -- se a loja não
  // tem NENHUM grama daquele filamento agora, pedir travava sempre depois
  // em "Registrar produção" (estoque insuficiente), beco sem saída (e não
  // dá pra comprar peça física já pronta dessa cor por aqui -- isso é
  // Vendas/<select> de variante conhecida, não este seletor de encomenda).
  const stockById = new Map(filaments.map((f) => [f.id, f.currentStockGrams.toNumber()]))

  const partById = new Map(parts.map((p) => [p.id, p]))

  return status.parts.map((partStatus): OrderablePartOption => {
    const part = partById.get(partStatus.partId)
    // Peça sintética (produto simples com insumo/acessório): sem
    // ProductPart real, sempre cor variável (mesmo tratamento de
    // getAssemblyStatus pro caso !isComposite).
    const isFixedRecipe = part ? part.filamentComponents.length >= 2 : false

    if (isFixedRecipe) {
      const label = part!.filamentComponents.map((c) => `${c.filament.manufacturer} ${c.filament.colorName} (${c.filament.material})`).join(' + ')
      return { partId: partStatus.partId, partName: partStatus.name, fixed: true, fixedLabel: label, colorOptions: [] }
    }

    // Bug "produção usou um Preto diferente do pedido": colorName+material
    // sozinhos não são únicos no catálogo (Filament é
    // @@unique([manufacturer, material, colorName]) -- dois fabricantes
    // podem ter "Preto (PLA)" cadastrado) -- sem marca, a pessoa que
    // registra o pedido pode escolher um filamento e quem registra a
    // produção escolher outro achando que é o mesmo (mesmo texto na tela),
    // e reconcileOrderReservations nunca casa os dois (exige o filamentId
    // EXATO). Catálogo inteiro (available: 0 incluso) precisa da marca no
    // label.
    const existing = new Map((partStatus.colorOptions ?? []).map((o) => [o.key, o]))
    const merged: AssemblyPartColorOption[] = filaments
      .filter((f) => (stockById.get(f.id) ?? 0) > 0)
      .map((f) => {
        const found = existing.get(f.id)
        return found ?? { key: f.id, filamentIds: [f.id], label: `${f.manufacturer} ${f.colorName} (${f.material})`, available: 0, colorHex: f.colorHex }
      })
    // Combo já produzido pra essa peça mas ainda não coberto acima (o
    // filamento correspondente esgotou depois, ou é um combo multi-
    // filamento) -- só entra se TODOS os componentes ainda têm estoque
    // agora, mesmo motivo do filter acima.
    for (const o of existing.values()) {
      if (merged.some((m) => m.key === o.key)) continue
      if (o.filamentIds.every((id) => (stockById.get(id) ?? 0) > 0)) merged.push(o)
    }

    return { partId: partStatus.partId, partName: partStatus.name, fixed: false, fixedLabel: null, colorOptions: merged }
  })
}

// Bug "não mostra a cor da variação criada": a tabela de Pedidos resolvia
// o rótulo de cada item batendo colorComboKey contra
// getProductVariantStockOptions (lib/reports.ts#getProductVariantBreakdown),
// que só lista combo JÁ PRODUZIDO alguma vez -- uma cor pedida via "+
// Montar variação personalizada" mas nunca impressa simplesmente não
// aparece lá, então o item ficava sem cor na tela mesmo com
// colorComboKey gravado certinho. Resolve pelo catálogo inteiro
// (getOrderablePartOptions já mescla produzido + catálogo, mesma fonte
// que o próprio seletor usa), cobrindo produto simples (peça sintética,
// key=productId, colorComboKey = filamentId puro) e composto
// (colorComboKey serializado, 1+ peças).
export async function resolveOrderItemColorLabel(productId: string, colorComboKey: string): Promise<{ label: string; colorHex: string | null } | null> {
  const options = await getOrderablePartOptions(productId)

  if (options.length === 1 && options[0].partId === productId && !options[0].fixed) {
    const opt = options[0].colorOptions.find((o) => o.key === colorComboKey)
    return opt ? { label: opt.label, colorHex: opt.colorHex } : null
  }

  const choices = deserializeColorChoices(colorComboKey)
  const labels: string[] = []
  let firstHex: string | null = null
  for (const option of options) {
    const chosen = choices[option.partId]
    if (chosen === undefined) continue
    if (option.fixed) {
      labels.push(`${option.partName}: ${option.fixedLabel}`)
      continue
    }
    const opt = option.colorOptions.find((o) => o.key === chosen)
    if (!opt) continue
    labels.push(`${option.partName}: ${opt.label}`)
    if (firstHex === null) firstHex = opt.colorHex
  }
  return labels.length > 0 ? { label: labels.join(' · '), colorHex: firstHex } : null
}

// Encomenda com variação personalizada: valida um colorChoicesJson
// ({ partId: filamentId }, do CustomVariantPicker) contra as peças REAIS
// do produto (nunca confia cegamente no client) antes de virar
// colorComboKey. Cálculo de serializeColorChoices fica sempre no servidor
// (nunca no client, que não importa lib/reports.ts -- é server-only, usa
// Prisma).
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

  // Bug "sem opção de variação nova pra produto simples": "+ Montar
  // variação personalizada" (CustomVariantPicker) passou a valer também
  // pra produto que não precisa de montagem (só o <select> de cores JÁ
  // produzidas existia antes) -- mas esse tipo de produto grava
  // colorComboKey como o filamentId PURO em todo outro lugar
  // (getProductVariantBreakdown/getRawVariantAvailable, ramo
  // !needsAssembly -- mesma convenção de Sale/ConsignmentDelivery), nunca
  // o formato serializado "partId:comboKey" (só existe pro ramo
  // needsAssembly=true, onde a chave vem de ProductAssembly.colorChoices).
  // Gravar serializado aqui pra um produto sem montagem repetiria o
  // mesmo bug já corrigido (reserva nunca acha a variante, claimable
  // sempre 0) -- detecta o caso (peça sintética única, key=productId,
  // convenção de getAssemblyStatus) e devolve o filamentId puro.
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } },
  })
  const needsAssembly = productNeedsAssembly({
    isComposite: product.isComposite,
    accessoryUsagesCount: product._count.accessoryUsages,
    supplyUsagesCount: product._count.supplyUsages,
    componentUsagesCount: product._count.componentUsages,
  })
  if (!needsAssembly && options.length === 1 && options[0].partId === productId) {
    return { colorComboKey: choices[productId] }
  }

  return { colorComboKey: serializeColorChoices(choices) }
}

// Melhoria "Pedidos com múltiplos itens": um pedido agora é 1 cabeçalho
// (channel/datas/comprador/número/observações, preenchido uma vez) + N
// itens (1 produto+cor+quantidade+preço cada) -- o formulário manda os
// campos do cabeçalho soltos e um `itemsJson` com a lista inteira (mesmo
// padrão de createSaleBatch/createConsignmentDeliveryBatch: tudo cria de
// uma vez, numa transação só). Cada item pode trazer seu próprio
// `colorChoicesJson` (do CustomVariantPicker), resolvido pra colorComboKey
// individualmente. Depois de criar, reconcilia cada par (productId,
// colorComboKey) distinto entre os itens novos -- exatamente como
// createOrder fazia pra 1 item só antes, só que em lote; os eventos de
// realocação de todos os itens voltam juntos pro form mostrar o aviso.
export async function createOrder(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  const headerParsed = orderHeaderSchema.safeParse({
    ...raw,
    buyerOrPlatform: raw.buyerOrPlatform || null,
    orderNumber: raw.orderNumber || null,
    notes: raw.notes || null,
  })
  if (!headerParsed.success) return { success: false, error: headerParsed.error.issues[0].message }

  let rawItems: unknown = []
  try {
    rawItems = JSON.parse(String(raw.itemsJson ?? '[]'))
  } catch {
    rawItems = []
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { success: false, error: 'Adicione pelo menos um item ao pedido' }
  }

  const resolvedItems: { productId: string; colorComboKey: string | null; quantity: number; unitPrice: number }[] = []
  for (const rawItem of rawItems as Record<string, unknown>[]) {
    let colorComboKey = (typeof rawItem.colorComboKey === 'string' ? rawItem.colorComboKey : null) || null
    if (typeof rawItem.colorChoicesJson === 'string' && rawItem.colorChoicesJson) {
      const resolved = await resolveCustomColorComboKey(String(rawItem.productId ?? ''), rawItem.colorChoicesJson)
      if ('error' in resolved) return { success: false, error: resolved.error }
      colorComboKey = resolved.colorComboKey
    }
    const itemParsed = orderItemSchema.safeParse({ productId: rawItem.productId, colorComboKey, quantity: rawItem.quantity, unitPrice: rawItem.unitPrice })
    if (!itemParsed.success) return { success: false, error: itemParsed.error.issues[0].message }
    resolvedItems.push({
      productId: itemParsed.data.productId,
      colorComboKey: itemParsed.data.colorComboKey ?? null,
      quantity: itemParsed.data.quantity,
      unitPrice: itemParsed.data.unitPrice,
    })
  }

  await prisma.order.create({
    data: {
      ...headerParsed.data,
      items: { create: resolvedItems },
    },
  })

  const distinctPairs = new Map<string, { productId: string; colorComboKey: string | null }>()
  for (const item of resolvedItems) distinctPairs.set(`${item.productId}::${item.colorComboKey ?? ''}`, item)

  const reallocations: OrderReallocationEvent[] = []
  for (const { productId, colorComboKey } of distinctPairs.values()) {
    reallocations.push(...(await reconcileOrderReservations(productId, colorComboKey)))
  }

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

// Sino de notificações (Task 9): quando um OrderItem chega num status
// terminal (ENTREGUE ou CANCELADO), checa se TODOS os itens do mesmo
// pedido já são terminais -- se sim, resolve a notificação genérica
// vinculada ao MarketplaceOrderInbox que originou este pedido (se algum;
// pedido criado manualmente, sem origem de marketplace, nunca tem
// inbox e não faz nada aqui). Extraído num helper porque
// updateOrderItemStatus tem DOIS caminhos de retorno que atualizam
// OrderItem.status (o early-return de status != ENTREGUE/com saleId, e o
// caminho que cria a Sale) -- os dois precisam rodar esta checagem, sem
// duplicar a lógica.
async function resolveMarketplaceNotificationIfTerminal(orderId: string, status: OrderStatus): Promise<void> {
  if (status !== 'ENTREGUE' && status !== 'CANCELADO') return
  const siblingItems = await prisma.orderItem.findMany({ where: { orderId }, select: { status: true } })
  if (!areAllItemsTerminal(siblingItems.map((s) => s.status))) return
  const inbox = await prisma.marketplaceOrderInbox.findUnique({ where: { confirmedOrderId: orderId } })
  if (inbox) await resolveNotificationsForResource('MarketplaceOrderInbox', inbox.id)
}

// Muda o status de um ITEM do pedido (não o pedido inteiro -- cada item
// tem seu próprio ciclo de vida desde "Pedidos com múltiplos itens"); ao
// chegar em ENTREGUE pela primeira vez (nunca se já tiver saleId --
// idempotente contra clique duplo/reentrada), cria a Sale correspondente
// com o costSnapshot já congelado (mesmo padrão de createSale em
// actions/sales.ts), puxando canal/comprador/número do CABEÇALHO (Order)
// via include, e vincula via OrderItem.saleId. Os status intermediários
// (AGUARDANDO_PRODUCAO/PARCIAL_.../AGUARDANDO_MONTAGEM/PRONTO_RESERVADO)
// não são setados por aqui -- são derivados por reconcileOrderReservations,
// a UI só mostra (ver OrderStatusForm.tsx).
export async function updateOrderItemStatus(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = updateStatusSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const item = await prisma.orderItem.findUniqueOrThrow({ where: { id }, include: { order: true } })

  if (parsed.data.status !== 'ENTREGUE' || item.saleId) {
    await prisma.orderItem.update({ where: { id }, data: { status: parsed.data.status } })
    await resolveMarketplaceNotificationIfTerminal(item.orderId, parsed.data.status)
    revalidatePath('/orders')
    return { success: true }
  }

  const breakdown = await getProductCostBreakdown(item.productId)
  const saleChannel = ORDER_CHANNEL_TO_SALE_CHANNEL[item.order.channel]
  const platformFee = await resolveSalePlatformFee(saleChannel, item.unitPrice.toNumber(), item.productId)
  const snapshot = buildSaleCostSnapshot(
    breakdown,
    item.quantity,
    platformFee ? { feePercent: platformFee.feePercent, feeFixed: platformFee.feeFixed, amountTotal: platformFee.feeAmountPerUnit * item.quantity } : undefined,
  )

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        channel: saleChannel,
        productId: item.productId,
        colorComboKey: item.colorComboKey,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        saleDate: new Date(),
        buyerOrPlatform: item.order.buyerOrPlatform ?? ORDER_CHANNEL_PLATFORM_LABEL[item.order.channel],
        notes: item.order.orderNumber ? `Pedido #${item.order.orderNumber}` : null,
        costSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        // Melhoria "Vendas: múltiplos produtos numa venda": Sale.batchId é
        // NOT NULL -- item de pedido concluído sempre vira uma venda de 1
        // item só, então recebe seu próprio lote (mesmo raciocínio de
        // createSale).
        batchId: randomUUID(),
      },
    })
    await tx.orderItem.update({ where: { id }, data: { status: 'ENTREGUE', saleId: sale.id } })
    // Melhoria "Histórico de consumo": mesmo consumo de embalagem que
    // createSale aplica (actions/sales.ts) -- item concluído vira Sale
    // aqui direto (nunca chama createSale), então precisa do mesmo passo.
    await consumePackagingForSale(tx, sale.id, item.productId, item.quantity)
  })

  // ENTREGUE é terminal -- sai da conta de "reservado", reconcilia pra
  // dar a próxima peça (se sobrar alguma, o que não deveria acontecer já
  // que este item só chega aqui com reservedQuantity == quantity, mas
  // roda mesmo assim por segurança/consistência).
  await reconcileOrderReservations(item.productId, item.colorComboKey)
  await resolveMarketplaceNotificationIfTerminal(item.orderId, 'ENTREGUE')

  revalidatePath('/orders')
  revalidatePath('/sales')
  revalidatePath('/stock')
  revalidatePath('/packaging')
  return { success: true }
}

// Melhoria "Pedidos com múltiplos itens": cancelar age no PEDIDO (todos os
// itens ainda não terminais de uma vez), já que a ação fica no cabeçalho
// na tela -- item já ENTREGUE (virou Sale) ou já CANCELADO fica intocado.
// Mesma filosofia de sempre: reservedQuantity NÃO é zerado (fica como
// registro do que aquele item chegou a ter), reconcileOrderReservations
// roda em seguida pra dar a peça liberada pro próximo item da fila.
export async function cancelOrder(id: string): Promise<ActionResult> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } })
  const targets = order.items.filter((i) => i.status !== 'CANCELADO' && i.status !== 'ENTREGUE')
  if (targets.length === 0) {
    return { success: false, error: 'Nenhum item pendente pra cancelar (já entregue ou cancelado).' }
  }
  await prisma.orderItem.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { status: 'CANCELADO' } })

  const distinctPairs = new Map<string, { productId: string; colorComboKey: string | null }>()
  for (const t of targets) distinctPairs.set(`${t.productId}::${t.colorComboKey ?? ''}`, t)
  const reallocations: OrderReallocationEvent[] = []
  for (const { productId, colorComboKey } of distinctPairs.values()) {
    reallocations.push(...(await reconcileOrderReservations(productId, colorComboKey)))
  }

  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Só pedido sem NENHUM item entregue pode ser removido -- uma vez com
// Sale vinculada, a Sale é o registro real da transação (deleteSale, se
// for o caso, já existe em actions/sales.ts). Order.items usa onDelete:
// Cascade (schema.prisma) -- apagar o cabeçalho já leva os itens junto.
//
// Bug "Excluir antes de Cancelar dá um bug": se algum item já teve uma
// realocação de peça (ganhou ou perdeu prioridade pra outro pedido --
// OrderReallocation, log permanente, nunca editado), o delete violava a FK
// RESTRICT dessa tabela e propagava um erro cru pra tela (Application
// error), em vez de uma mensagem explicando o que fazer -- cancelar
// primeiro (só muda o status do item, nunca apaga a linha, então nunca
// esbarra nesse RESTRICT) resolve. Mesmo padrão de isForeignKeyConstraintError
// já usado em accessories/filaments/supplies/printers pra esse tipo de FK.
export async function deleteOrder(id: string): Promise<ActionResult> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } })
  if (order.items.some((i) => i.saleId)) {
    return { success: false, error: 'Este pedido já tem item(ns) entregue(s) que viraram venda — remova a venda em Vendas, se necessário.' }
  }
  const pairs = new Map<string, { productId: string; colorComboKey: string | null }>()
  for (const i of order.items) pairs.set(`${i.productId}::${i.colorComboKey ?? ''}`, i)

  try {
    await prisma.order.delete({ where: { id } })
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return { success: false, error: 'Este pedido tem histórico de realocação de peça com outro pedido e não pode ser excluído direto — cancele os itens pendentes primeiro (opção "Cancelar").' }
    }
    throw err
  }

  for (const { productId, colorComboKey } of pairs.values()) {
    await reconcileOrderReservations(productId, colorComboKey)
  }
  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true }
}

// Melhoria "Fila de demanda em Produção/Montagem": 1 linha por (item de
// pedido, peça-ou-produto) que ainda falta pra fechar aquele item -- só
// item não-terminal com quantity > reservedQuantity entra aqui. Produto
// sem componente nenhum (não precisa de montagem) só pode faltar
// "produzir o produto direto" -- entra em productionRows. Produto que
// precisa de montagem quebra o que falta em, por peça: quanto dá pra
// cobrir com peça JÁ produzida esperando montagem (assemblyRows) e quanto
// ainda falta produzir de cada peça (productionRows) -- reivindicando de
// um "pool" corrido por peça (inicializado do que getAssemblyStatus
// reporta como disponível agora), na mesma ordem de prioridade por prazo
// que reconcileOrderReservations usa pra reserva de verdade (o prazo
// agora mora no cabeçalho -- ordena via `order.deliveryDate`), pra não
// superestimar quando 2+ itens disputam a mesma peça na exibição.
export interface OrderDemandRow {
  orderItemId: string
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
  // Encomenda com variação personalizada: colorComboKey inteiro do item
  // (todas as peças), pra Montagem pré-selecionar a combinação certa;
  // comboLabel/filamentIds são só da PEÇA desta linha (produção só
  // imprime uma peça por vez), null quando o item não tem cor específica
  // ou a peça é receita fixa.
  colorComboKey: string | null
  comboLabel: string | null
  filamentIds: string[] | null
}

export async function getOrderDemandQueue(): Promise<{ productionRows: OrderDemandRow[]; assemblyRows: OrderDemandRow[] }> {
  const items = await prisma.orderItem.findMany({
    where: { status: { notIn: ['ENTREGUE', 'CANCELADO'] } },
    include: {
      product: { include: { _count: { select: { accessoryUsages: true, supplyUsages: true, componentUsages: true } } } },
      order: { select: { orderNumber: true, channel: true, buyerOrPlatform: true, deliveryDate: true } },
    },
    orderBy: [{ order: { deliveryDate: 'asc' } }, { createdAt: 'asc' }],
  })
  const pending = items.filter((i) => i.quantity > i.reservedQuantity)
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
  // variável, o combo escolhido no item é sempre 1 filamentId sozinho
  // (resolveCustomColorComboKey só aceita escolha assim), então dá pra
  // resolver o rótulo direto no catálogo -- carregado uma vez só, sob
  // demanda (nenhuma linha com colorComboKey, nenhuma query).
  let filamentById: Map<string, { manufacturer: string; colorName: string; material: string }> | null = null
  async function getFilamentLabel(filamentId: string): Promise<string | null> {
    if (!filamentById) {
      const all = await prisma.filament.findMany({ select: { id: true, manufacturer: true, colorName: true, material: true } })
      filamentById = new Map(all.map((f) => [f.id, { manufacturer: f.manufacturer, colorName: f.colorName, material: f.material }]))
    }
    const f = filamentById.get(filamentId)
    // Bug "produção usou um Preto diferente do pedido": ver comentário em
    // getOrderablePartOptions acima -- marca entra pro mesmo motivo.
    return f ? `${f.manufacturer} ${f.colorName} (${f.material})` : null
  }

  for (const item of pending) {
    const shortfall = item.quantity - item.reservedQuantity
    const product = item.product
    const base = {
      orderItemId: item.id,
      orderNumber: item.order.orderNumber,
      channel: item.order.channel,
      buyerOrPlatform: item.order.buyerOrPlatform,
      deliveryDate: item.order.deliveryDate,
      status: item.status,
      productId: product.id,
      productName: product.name,
      reservedQuantity: item.reservedQuantity,
      quantity: item.quantity,
      colorComboKey: item.colorComboKey,
    }

    const needsAssembly = productNeedsAssembly({
      isComposite: product.isComposite,
      accessoryUsagesCount: product._count.accessoryUsages,
      supplyUsagesCount: product._count.supplyUsages,
      componentUsagesCount: product._count.componentUsages,
    })

    // Bug "não sincroniza com o pedido -- variação nova não informa a cor":
    // este branch sempre mandava comboLabel/filamentIds null, ignorando
    // item.colorComboKey -- sobrou de antes de produto simples poder ter
    // cor pedida (nem <select> de variante conhecida nem "+ Montar
    // variação personalizada" existiam ainda pra esse caso). Produto
    // simples grava colorComboKey como o filamentId PURO (convenção de
    // !needsAssembly, nunca serializado) -- resolve direto, igual ao
    // comboInfoForPart faz pro caso needsAssembly=true logo abaixo.
    if (!needsAssembly) {
      const filamentId = item.colorComboKey
      const comboLabel = filamentId ? await getFilamentLabel(filamentId) : null
      productionRows.push({ ...base, partId: null, partName: null, neededUnits: shortfall, comboLabel, filamentIds: filamentId ? [filamentId] : null })
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

    // Encomenda com variação personalizada: item com colorComboKey só
    // reivindica a fatia do combo que ELE pediu (nunca a soma de todas
    // as cores da peça); item sem variante continua reivindicando o pool
    // agregado de sempre, drenando de qualquer combo (não importa a cor
    // pra ele) -- mantém os dois tipos de item consumindo do MESMO
    // estoque físico subjacente, sem contar a peça duas vezes.
    const choices = item.colorComboKey ? deserializeColorChoices(item.colorComboKey) : null

    function availableForPart(partId: string): number {
      const combos = comboPools.get(partId)
      // Bug "produção registrada mas pedido continua pendente pra sempre":
      // item com colorComboKey só tem entrada pras peças de COR VARIÁVEL
      // que o cliente escolheu -- uma peça de receita fixa (ou uma peça sem
      // cor pra esse item) nunca aparece em `choices` (ver
      // resolveCustomColorComboKey). `choices[partId] ?? ''` tratava essa
      // ausência como "peça pediu o combo de chave vazia" -- que nunca
      // existe em `combos` -- e zerava disponível pra sempre, mesmo com
      // produção real disponível (confirmado: Montagem mostrava disponível
      // correto pra mesma peça). Só usa o combo específico quando o item
      // REALMENTE escolheu uma cor pra esta peça -- senão cai no pool
      // agregado, igual `comboInfoForPart` já fazia (retornando null em vez
      // de inventar um combo).
      const chosenKey = choices?.[partId]
      if (chosenKey !== undefined && combos) return combos.get(chosenKey) ?? 0
      return pool.get(partId) ?? 0
    }

    function consumeFromPart(partId: string, units: number): void {
      pool.set(partId, (pool.get(partId) ?? 0) - units)
      const combos = comboPools.get(partId)
      if (!combos) return
      // Mesmo ajuste de availableForPart acima: só drena um combo
      // específico quando o item REALMENTE escolheu cor pra esta peça --
      // senão drena proporcionalmente por todos os combos (igual ao item
      // sem cor nenhuma), pra não deixar saldo de combo desatualizado pra
      // um próximo item da fila que escolha uma cor específica desta peça.
      const chosenKey = choices?.[partId]
      if (chosenKey !== undefined) {
        combos.set(chosenKey, (combos.get(chosenKey) ?? 0) - units)
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
      // (produced-only). O combo de um item é sempre 1 filamentId sozinho
      // pra peça de cor variável, então resolve pelo catálogo.
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
// botão manual (DemandQueuePanel) pra varrer e reconciliar TODO item
// pendente de uma vez -- corrige item cuja reconciliação deveria ter
// rodado num evento passado mas ficou pra trás (ex.: criado antes de um
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
