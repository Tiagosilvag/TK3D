'use server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { orderHeaderSchema, orderItemSchema, orderStatusEnum, updateOrderItemSchema, orderDraftItemUpdateSchema } from '@/lib/validation/order'
import { formatCurrency } from '@/lib/format'
import { getProductCostBreakdown } from '@/actions/products'
import { consumePackagingForSale, deleteSale } from '@/actions/sales'
import { deleteConsignmentDelivery } from '@/actions/consignmentDeliveries'
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
  // Aviso "acessório sem estoque suficiente pro pedido": quantidade deste
  // item consumida por UNIDADE do produto (AssemblyPartStatus/
  // AssemblyResourceRequirement.quantityPerUnit) -- multiplicado pela
  // quantidade do pedido, compara contra colorOptions[].available (estoque
  // real, AGORA) pra avisar ANTES de confirmar, não só na hora da
  // montagem.
  quantityPerUnit: number
  // Peça impressa (source='part') ficar sem estoque é esperado -- "vão pra
  // produção" já avisa disso (ItemCard). Acessório (source='accessory') é
  // item comprado, não impresso -- faltar é uma surpresa ruim só descoberta
  // hoje na Montagem; CustomVariantPicker avisa só pra este tipo.
  source: 'part' | 'accessory'
}

// Bug "pedido com acessório de cor variável nunca reconcilia, mesmo já
// produzido e montado": esta função só mapeava status.parts (peça
// impressa), nunca status.accessoryRequirements -- um produto com
// acessório de cor variável (ex.: CORRENTE Prata/Dourada numa CANECA)
// montava a combinação de cor do pedido (colorComboKey, via
// resolveCustomColorComboKey abaixo) SEM a escolha do acessório, porque
// "+ Montar variação personalizada" nunca oferecia essa opção pra
// escolher. confirmAssembly (actions/assembly.ts#performAssembly), por
// outro lado, SEMPRE grava a cor do acessório escolhido em
// ProductAssembly.colorChoices junto com as peças (mesma lógica que
// ConfirmAssemblyForm.tsx já mescla na tela de Montagem) -- a chave
// serializada (serializeColorChoices) da montagem real sempre tinha 1
// campo A MAIS que a do pedido, então nunca batiam, por mais que se
// produzisse/montasse: reconcileOrderReservations (e "Recalcular
// pedidos") exige IGUALDADE EXATA da chave inteira. Fix: mescla acessório
// com "irmãos" de cor (colorOptions não nulo) na mesma lista de opções,
// com o MESMO formato de peça (key = Accessory.id, igual
// colorChoicesToStore[accessory.id] grava) -- igual ao merge que
// ConfirmAssemblyForm.tsx já faz pro lado da Montagem. Acessório sem
// "irmãos" (colorOptions null) nunca vira opção aqui, mesmo motivo de
// performAssembly nunca gravar uma chave pra ele.
//
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

  const partOptions = status.parts.map((partStatus): OrderablePartOption => {
    const part = partById.get(partStatus.partId)
    // Peça sintética (produto simples com insumo/acessório): sem
    // ProductPart real, sempre cor variável (mesmo tratamento de
    // getAssemblyStatus pro caso !isComposite). Peça real é fixa quando
    // tem 2+ componentes (estrutural, sempre foi assim) OU quando o
    // usuário marcou `fixedRecipe` explicitamente no cadastro do produto
    // (pedido "receita fixa em qualquer peça" -- deixa fixar também uma
    // peça de 1 filamento só).
    const isFixedRecipe = part ? (part.fixedRecipe || part.filamentComponents.length >= 2) : false

    if (isFixedRecipe) {
      const label = part!.filamentComponents.map((c) => `${c.filament.manufacturer} ${c.filament.colorName} (${c.filament.material})`).join(' + ')
      return { partId: partStatus.partId, partName: partStatus.name, fixed: true, fixedLabel: label, colorOptions: [], quantityPerUnit: partStatus.quantityPerUnit, source: 'part' }
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
        return found ?? {
          key: f.id,
          filamentIds: [f.id],
          label: `${f.manufacturer} ${f.colorName} (${f.material})`,
          available: 0,
          colorHex: f.colorHex,
          colors: [{ hex: f.colorHex, name: f.colorName }],
          material: f.material,
        }
      })
    // Combo já produzido pra essa peça mas ainda não coberto acima (o
    // filamento correspondente esgotou depois, ou é um combo multi-
    // filamento) -- só entra se TODOS os componentes ainda têm estoque
    // agora, mesmo motivo do filter acima.
    for (const o of existing.values()) {
      if (merged.some((m) => m.key === o.key)) continue
      if (o.filamentIds.every((id) => (stockById.get(id) ?? 0) > 0)) merged.push(o)
    }

    return { partId: partStatus.partId, partName: partStatus.name, fixed: false, fixedLabel: null, colorOptions: merged, quantityPerUnit: partStatus.quantityPerUnit, source: 'part' }
  })

  const accessoryOptions: OrderablePartOption[] = status.accessoryRequirements
    .filter((a) => a.colorOptions)
    .map((a) => ({ partId: a.id, partName: a.name, fixed: false, fixedLabel: null, colorOptions: a.colorOptions!, quantityPerUnit: a.quantityPerUnit, source: 'accessory' }))

  return [...partOptions, ...accessoryOptions]
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

type ResolvedOrderItem = { productId: string; colorComboKey: string | null; quantity: number; unitPrice: number }

// Lido por createOrder E addOrderItems (extraído quando "adicionar item a
// um pedido já existente" precisou do MESMO parse/validação de itemsJson
// que createOrder já fazia pro cabeçalho) -- cada item pode trazer seu
// próprio `colorChoicesJson` (do CustomVariantPicker), resolvido pra
// colorComboKey individualmente contra as peças reais do produto.
async function resolveOrderItemsJson(itemsJsonRaw: FormDataEntryValue | undefined): Promise<{ items: ResolvedOrderItem[] } | { error: string }> {
  let rawItems: unknown = []
  try {
    rawItems = JSON.parse(String(itemsJsonRaw ?? '[]'))
  } catch {
    rawItems = []
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'Adicione pelo menos um item ao pedido' }
  }

  const resolvedItems: ResolvedOrderItem[] = []
  for (const rawItem of rawItems as Record<string, unknown>[]) {
    let colorComboKey = (typeof rawItem.colorComboKey === 'string' ? rawItem.colorComboKey : null) || null
    if (typeof rawItem.colorChoicesJson === 'string' && rawItem.colorChoicesJson) {
      const resolved = await resolveCustomColorComboKey(String(rawItem.productId ?? ''), rawItem.colorChoicesJson)
      if ('error' in resolved) return { error: resolved.error }
      colorComboKey = resolved.colorComboKey
    }
    const itemParsed = orderItemSchema.safeParse({ productId: rawItem.productId, colorComboKey, quantity: rawItem.quantity, unitPrice: rawItem.unitPrice })
    if (!itemParsed.success) return { error: itemParsed.error.issues[0].message }
    resolvedItems.push({
      productId: itemParsed.data.productId,
      colorComboKey: itemParsed.data.colorComboKey ?? null,
      quantity: itemParsed.data.quantity,
      unitPrice: itemParsed.data.unitPrice,
    })
  }
  return { items: resolvedItems }
}

// Reconcilia cada par (productId, colorComboKey) DISTINTO entre os itens
// recém-criados (createOrder/addOrderItems) -- compartilhado pra não
// reconciliar o mesmo par duas vezes quando 2 itens do mesmo lote pedem
// produto+cor iguais.
async function reconcileDistinctPairs(items: ResolvedOrderItem[]): Promise<OrderReallocationEvent[]> {
  const distinctPairs = new Map<string, { productId: string; colorComboKey: string | null }>()
  for (const item of items) distinctPairs.set(`${item.productId}::${item.colorComboKey ?? ''}`, item)
  const reallocations: OrderReallocationEvent[] = []
  for (const { productId, colorComboKey } of distinctPairs.values()) {
    reallocations.push(...(await reconcileOrderReservations(productId, colorComboKey)))
  }
  return reallocations
}

// Melhoria "Pedidos com múltiplos itens": um pedido agora é 1 cabeçalho
// (channel/datas/comprador/número/observações, preenchido uma vez) + N
// itens (1 produto+cor+quantidade+preço cada) -- o formulário manda os
// campos do cabeçalho soltos e um `itemsJson` com a lista inteira (mesmo
// padrão de createSaleBatch/createConsignmentDeliveryBatch: tudo cria de
// uma vez, numa transação só). Depois de criar, reconcilia cada par
// (productId, colorComboKey) distinto entre os itens novos; os eventos de
// realocação de todos os itens voltam juntos pro form mostrar o aviso.
export async function createOrder(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  const headerParsed = orderHeaderSchema.safeParse({
    ...raw,
    buyerOrPlatform: raw.buyerOrPlatform || null,
    orderNumber: raw.orderNumber || null,
    notes: raw.notes || null,
    consignmentPartnerId: raw.consignmentPartnerId || null,
  })
  if (!headerParsed.success) return { success: false, error: headerParsed.error.issues[0].message }

  const resolved = await resolveOrderItemsJson(raw.itemsJson)
  if ('error' in resolved) return { success: false, error: resolved.error }

  await prisma.order.create({
    data: {
      ...headerParsed.data,
      items: { create: resolved.items },
    },
  })

  const reallocations = await reconcileDistinctPairs(resolved.items)

  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Pedido do usuário: dava pra criar um pedido com N itens de uma vez
// (createOrder acima), mas não dava pra ACRESCENTAR item a um pedido JÁ
// criado (ex.: lembrar de incluir a peça BASE depois) -- único jeito era
// cancelar e recriar o pedido inteiro. Mesmo parse/validação/reconciliação
// de itemsJson que createOrder usa (resolveOrderItemsJson/
// reconcileDistinctPairs compartilhados), só que os itens viram OrderItem
// de um Order EXISTENTE em vez de criar um cabeçalho novo -- cabeçalho
// (channel/datas/comprador/número/observações) nunca muda por aqui.
export async function addOrderItems(orderId: string, formData: FormData): Promise<ActionResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  if (!order) return { success: false, error: 'Pedido não encontrado.' }

  const resolved = await resolveOrderItemsJson(formData.get('itemsJson') ?? undefined)
  if ('error' in resolved) return { success: false, error: resolved.error }

  await prisma.orderItem.createMany({
    data: resolved.items.map((item) => ({ ...item, orderId })),
  })

  const reallocations = await reconcileDistinctPairs(resolved.items)

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
// existir. `Exclude<OrderChannel, 'CONSIGNADO'>` (em vez de OrderChannel
// puro) documenta no tipo que Consignado nunca passa por aqui -- vira
// ConsignmentDelivery em updateOrderItemStatus, nunca Sale.
const ORDER_CHANNEL_TO_SALE_CHANNEL: Record<Exclude<OrderChannel, 'CONSIGNADO'>, SaleChannel> = {
  DIRETA: 'DIRETA',
  SHOPEE: 'MARKETPLACE',
  MERCADO_LIVRE: 'MARKETPLACE',
}
const ORDER_CHANNEL_PLATFORM_LABEL: Record<Exclude<OrderChannel, 'CONSIGNADO'>, string> = {
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
// chegar em ENTREGUE pela primeira vez (nunca se já virou Sale OU
// ConsignmentDelivery -- idempotente contra clique duplo/reentrada, os
// dois mutuamente exclusivos por item), cria o registro correspondente
// com o costSnapshot já congelado quando é Sale (mesmo padrão de
// createSale em actions/sales.ts), puxando canal/comprador/número do
// CABEÇALHO (Order) via include. Pedido do usuário "criar pedidos de
// encomendas de consignados também": canal CONSIGNADO cria uma
// ConsignmentDelivery em vez de Sale (ver comentário na função abaixo).
// Os status intermediários (AGUARDANDO_PRODUCAO/PARCIAL_.../
// AGUARDANDO_MONTAGEM/PRONTO_RESERVADO) não são setados por aqui -- são
// derivados por reconcileOrderReservations, a UI só mostra
// (ver OrderStatusForm.tsx).
export async function updateOrderItemStatus(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = updateStatusSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const item = await prisma.orderItem.findUniqueOrThrow({ where: { id }, include: { order: true } })

  if (parsed.data.status !== 'ENTREGUE' || item.saleId || item.consignmentDeliveryId) {
    await prisma.orderItem.update({ where: { id }, data: { status: parsed.data.status } })
    await resolveMarketplaceNotificationIfTerminal(item.orderId, parsed.data.status)
    revalidatePath('/orders')
    return { success: true }
  }

  if (item.order.channel === 'CONSIGNADO') {
    // Mesmo shape que createConsignmentDelivery grava hoje
    // (actions/consignmentDeliveries.ts) -- entrega em consignação nunca
    // consome embalagem (isso só acontece na venda final, registrada
    // depois em Consignação > Relatórios de venda) nem monta
    // costSnapshot (ConsignmentDelivery não tem esse campo).
    await prisma.$transaction(async (tx) => {
      const delivery = await tx.consignmentDelivery.create({
        data: {
          batchId: randomUUID(),
          partnerId: item.order.consignmentPartnerId!,
          productId: item.productId,
          colorComboKey: item.colorComboKey,
          quantityDelivered: item.quantity,
          unitPrice: item.unitPrice,
          deliveryDate: new Date(),
          notes: item.order.orderNumber ? `Pedido #${item.order.orderNumber}` : null,
        },
      })
      await tx.orderItem.update({ where: { id }, data: { status: 'ENTREGUE', consignmentDeliveryId: delivery.id } })
    })
  } else {
    const breakdown = await getProductCostBreakdown(item.productId)
    const saleChannel = ORDER_CHANNEL_TO_SALE_CHANNEL[item.order.channel]
    const platformLabel = ORDER_CHANNEL_PLATFORM_LABEL[item.order.channel]
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
          buyerOrPlatform: item.order.buyerOrPlatform ?? platformLabel,
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
  }

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
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Redesign "Pedidos" -- toast "Desfazer" do botão "✓ Entregar tudo":
// reverte exatamente o que updateOrderItemStatus('ENTREGUE') acabou de
// criar, reaproveitando deleteSale (restaura embalagem) ou
// deleteConsignmentDelivery (consignado) em vez de duplicar aquela
// lógica. Zera o vínculo (saleId/consignmentDeliveryId) e devolve o item
// pro status AGUARDANDO_PRODUCAO-como-placeholder só pra entrar de volta
// no pool não-terminal de reconcileOrderReservations -- que já
// recalcula o status de verdade (provavelmente PRONTO_RESERVADO de
// novo, já que a peça nunca deixou de existir fisicamente) na mesma
// chamada.
export async function undoOrderItemDelivery(id: string): Promise<ActionResult> {
  const item = await prisma.orderItem.findUniqueOrThrow({ where: { id } })
  if (item.saleId) {
    await deleteSale(item.saleId)
    await prisma.orderItem.update({ where: { id }, data: { saleId: null, status: 'AGUARDANDO_PRODUCAO' } })
  } else if (item.consignmentDeliveryId) {
    await deleteConsignmentDelivery(item.consignmentDeliveryId)
    await prisma.orderItem.update({ where: { id }, data: { consignmentDeliveryId: null, status: 'AGUARDANDO_PRODUCAO' } })
  } else {
    return { success: false, error: 'Nada para desfazer neste item.' }
  }
  await reconcileOrderReservations(item.productId, item.colorComboKey)
  revalidatePath('/orders')
  revalidatePath('/sales')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Pedido do usuário (redesign "Pedidos"): "opção de editar o valor mesmo
// depois de entregue" -- até aqui, um item com saleId/consignmentDeliveryId
// setado (já virou Sale/ConsignmentDelivery) ficava travado por completo em
// updateOrderItem/updateOrderDraft, com a mensagem "edite em Vendas/
// Consignação, se necessário". O VALOR (preço cobrado) é a correção mais
// comum depois de entregue (cliente negociou desconto, erro de digitação) e
// não precisa da trava inteira -- só reabre esse 1 campo, reaproveitando o
// mesmo recálculo de costSnapshot que updateSale (actions/sales.ts) já faz
// pra qualquer edição de venda (preço novo muda a taxa de plataforma
// percentual, então o snapshot precisa refletir isso; produto/quantidade
// continuam os mesmos, só o preço muda). ConsignmentDelivery não tem
// costSnapshot (a venda de verdade só acontece depois, via
// ConsignmentSaleReport) -- só atualiza unitPrice. Gera 1 OrderEditLog
// (mesmo padrão de updateOrderDraft) pra aparecer no "Histórico de
// alterações" do drawer -- é uma edição de pedido como qualquer outra, só
// que feita depois do item já ter saído.
export async function updateDeliveredItemPrice(orderItemId: string, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ unitPrice: z.coerce.number().positive('Valor inválido') }).safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { unitPrice } = parsed.data

  const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, include: { product: true } })
  if (!item.saleId && !item.consignmentDeliveryId) return { success: false, error: 'Este item ainda não foi entregue.' }

  const oldUnitPrice = item.unitPrice.toNumber()
  if (oldUnitPrice === unitPrice) return { success: true }

  if (item.saleId) {
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: item.saleId } })
    const breakdown = await getProductCostBreakdown(sale.productId)
    const platformFee = await resolveSalePlatformFee(sale.channel, unitPrice, sale.productId)
    const snapshot = buildSaleCostSnapshot(
      breakdown,
      sale.quantity,
      platformFee ? { feePercent: platformFee.feePercent, feeFixed: platformFee.feeFixed, amountTotal: platformFee.feeAmountPerUnit * sale.quantity } : undefined,
    )
    await prisma.sale.update({ where: { id: sale.id }, data: { unitPrice, costSnapshot: snapshot as unknown as Prisma.InputJsonValue } })
  } else {
    await prisma.consignmentDelivery.update({ where: { id: item.consignmentDeliveryId! }, data: { unitPrice } })
  }
  await prisma.orderItem.update({ where: { id: orderItemId }, data: { unitPrice } })
  await prisma.orderEditLog.create({
    data: {
      orderId: item.orderId,
      changes: [{ label: `${item.product.name}: valor (pós-entrega)`, from: formatCurrency(oldUnitPrice), to: formatCurrency(unitPrice) }],
    },
  })

  revalidatePath('/orders')
  revalidatePath('/sales')
  revalidatePath('/consignment/deliveries')
  return { success: true }
}

// Pedido do usuário "editar item depois de adicionado": corrige
// quantidade/valor de um OrderItem já salvo, sem precisar cancelar e
// recriar o pedido inteiro. Só produto/cor continuam fixos (trocar isso
// exigiria resolver combo/estoque de novo, fora de escopo aqui). Bloqueado
// pra item que já virou Sale (saleId setado) -- aquilo é histórico de
// venda de verdade, não dá pra editar por trás; o jeito de corrigir um
// item já entregue é editar a Sale em Vendas. reconcileOrderReservations
// recalcula reservedQuantity do zero pra TODO o pool (productId,
// colorComboKey) usando a quantidade nova -- cobre tanto aumentar
// (pode entrar na fila por mais peça) quanto diminuir (reservedQuantity
// nunca fica maior que quantity depois, mesmo sem um cálculo manual de
// "encolher" aqui).
export async function updateOrderItem(id: string, formData: FormData): Promise<ActionResult> {
  const parsed = updateOrderItemSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const item = await prisma.orderItem.findUniqueOrThrow({ where: { id } })
  if (item.saleId) return { success: false, error: 'Este item já virou venda -- edite em Vendas, se necessário.' }
  if (item.consignmentDeliveryId) return { success: false, error: 'Este item já virou entrega de consignação -- edite em Consignação, se necessário.' }

  await prisma.orderItem.update({ where: { id }, data: { quantity: parsed.data.quantity, unitPrice: parsed.data.unitPrice } })
  const reallocations = await reconcileOrderReservations(item.productId, item.colorComboKey)

  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Pedido do usuário "editar item depois de adicionado": remove UM item do
// pedido (ao contrário de deleteOrder, que apaga o cabeçalho inteiro) --
// pra quando um item foi adicionado por engano. Mesmas 2 guardas de
// deleteOrder, só que por item: saleId setado (virou venda de verdade,
// histórico imutável) e FK RESTRICT de OrderReallocation (item que já
// disputou prioridade com outro pedido -- orientado a cancelar o pedido
// em vez de excluir, única ação que nunca apaga a linha). Guarda extra só
// daqui: não deixa remover o ÚLTIMO item (um pedido sem nenhum item seria
// um estado nunca previsto em nenhuma tela -- excluir o pedido inteiro é
// a ação certa nesse caso).
export async function removeOrderItem(id: string): Promise<ActionResult> {
  const item = await prisma.orderItem.findUniqueOrThrow({ where: { id } })
  if (item.saleId) return { success: false, error: 'Este item já virou venda -- remova a venda em Vendas, se necessário.' }
  if (item.consignmentDeliveryId) return { success: false, error: 'Este item já virou entrega de consignação -- remova a entrega em Consignação, se necessário.' }

  const siblingCount = await prisma.orderItem.count({ where: { orderId: item.orderId } })
  if (siblingCount <= 1) return { success: false, error: 'Este é o único item do pedido -- exclua o pedido inteiro em vez de remover o item.' }

  try {
    await prisma.orderItem.delete({ where: { id } })
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return { success: false, error: 'Este item tem histórico de realocação de peça com outro pedido e não pode ser removido direto -- cancele o pedido em vez disso.' }
    }
    throw err
  }

  const remaining = await prisma.orderItem.findMany({ where: { orderId: item.orderId }, select: { status: true } })
  if (areAllItemsTerminal(remaining.map((r) => r.status))) {
    const inbox = await prisma.marketplaceOrderInbox.findUnique({ where: { confirmedOrderId: item.orderId } })
    if (inbox) await resolveNotificationsForResource('MarketplaceOrderInbox', inbox.id)
  }

  const reallocations = await reconcileOrderReservations(item.productId, item.colorComboKey)

  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Redesign "Pedidos" -- drawer de detalhe: ao contrário de
// updateOrderItem/removeOrderItem/addOrderItems (cada um salva 1 mudança
// na hora), o drawer deixa editar quantidade/valor de vários itens,
// adicionar item novo, remover item E trocar a data de entrega numa
// ÚNICA sessão, só gravada no clique de "Salvar alterações" -- esta
// action aplica tudo de uma vez e grava 1 OrderEditLog descrevendo a
// sessão inteira (nunca 1 log por campo). Reaproveita as MESMAS guardas
// de updateOrderItem/removeOrderItem (bloqueado se saleId/
// consignmentDeliveryId) e o mesmo resolveOrderItemsJson que createOrder/
// addOrderItems já usam pra itens novos -- nenhuma regra de negócio
// duplicada, só orquestrada em lote.
function formatDiffDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export async function updateOrderDraft(orderId: string, formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: { include: { product: true } } } })
  if (!order) return { success: false, error: 'Pedido não encontrado.' }
  const itemById = new Map(order.items.map((i) => [i.id, i]))

  let itemUpdatesRaw: unknown = []
  let removedItemIdsRaw: unknown = []
  try {
    itemUpdatesRaw = JSON.parse(String(raw.itemUpdatesJson ?? '[]'))
    removedItemIdsRaw = JSON.parse(String(raw.removedItemIdsJson ?? '[]'))
  } catch {
    return { success: false, error: 'Dados de edição inválidos.' }
  }
  const itemUpdatesParsed = z.array(orderDraftItemUpdateSchema).safeParse(itemUpdatesRaw)
  if (!itemUpdatesParsed.success) return { success: false, error: itemUpdatesParsed.error.issues[0].message }
  const removedItemIdsParsed = z.array(z.string()).safeParse(removedItemIdsRaw)
  if (!removedItemIdsParsed.success) return { success: false, error: 'Dados de edição inválidos.' }
  const itemUpdates = itemUpdatesParsed.data
  const removedItemIds = removedItemIdsParsed.data

  const newItemsResolved = raw.newItemsJson ? await resolveOrderItemsJson(raw.newItemsJson) : { items: [] }
  if ('error' in newItemsResolved) return { success: false, error: newItemsResolved.error }
  const newItems = newItemsResolved.items

  // Guardas -- mesmas de updateOrderItem/removeOrderItem, checadas ANTES
  // de qualquer escrita (tudo ou nada: uma sessão inteira falha junto se
  // um item alvo já virou Sale/ConsignmentDelivery).
  for (const { id } of itemUpdates) {
    const item = itemById.get(id)
    if (!item) return { success: false, error: 'Item não encontrado neste pedido.' }
    if (item.saleId) return { success: false, error: 'Um item já virou venda -- edite em Vendas, se necessário.' }
    if (item.consignmentDeliveryId) return { success: false, error: 'Um item já virou entrega de consignação -- edite em Consignação, se necessário.' }
  }
  for (const id of removedItemIds) {
    const item = itemById.get(id)
    if (!item) return { success: false, error: 'Item não encontrado neste pedido.' }
    if (item.saleId) return { success: false, error: 'Um item já virou venda -- remova a venda em Vendas, se necessário.' }
    if (item.consignmentDeliveryId) return { success: false, error: 'Um item já virou entrega de consignação -- remova a entrega em Consignação, se necessário.' }
  }
  const remainingCount = order.items.length - removedItemIds.length + newItems.length
  if (remainingCount < 1) return { success: false, error: 'O pedido precisa ficar com pelo menos 1 item.' }

  let newDeliveryDate: Date | null = null
  if (raw.deliveryDate) {
    const parsedDate = z.coerce.date({ errorMap: () => ({ message: 'Data de entrega inválida' }) }).safeParse(raw.deliveryDate)
    if (!parsedDate.success) return { success: false, error: parsedDate.error.issues[0].message }
    if (parsedDate.data.getTime() !== order.deliveryDate.getTime()) newDeliveryDate = parsedDate.data
  }

  // Monta o resumo ANTES de escrever nada (compara contra o snapshot já
  // carregado em `order`) -- se nada mudou de verdade (ex.: usuário abriu
  // e fechou o drawer sem editar nada), não grava OrderEditLog nenhum.
  const changes: { label: string; from: string; to: string }[] = []
  for (const { id, quantity, unitPrice } of itemUpdates) {
    const item = itemById.get(id)!
    if (item.quantity !== quantity) changes.push({ label: `${item.product.name}: quantidade`, from: String(item.quantity), to: String(quantity) })
    if (item.unitPrice.toNumber() !== unitPrice) changes.push({ label: `${item.product.name}: valor`, from: formatCurrency(item.unitPrice.toNumber()), to: formatCurrency(unitPrice) })
  }
  for (const id of removedItemIds) {
    const item = itemById.get(id)!
    changes.push({ label: 'Item removido', from: item.product.name, to: '—' })
  }
  if (newItems.length > 0) {
    const newProducts = await prisma.product.findMany({ where: { id: { in: newItems.map((i) => i.productId) } }, select: { id: true, name: true } })
    const nameById = new Map(newProducts.map((p) => [p.id, p.name]))
    for (const item of newItems) changes.push({ label: 'Item adicionado', from: '—', to: `${nameById.get(item.productId) ?? item.productId} (${item.quantity}x)` })
  }
  if (newDeliveryDate) changes.push({ label: 'Entrega', from: formatDiffDate(order.deliveryDate), to: formatDiffDate(newDeliveryDate) })

  if (changes.length === 0) return { success: true }

  for (const { id, quantity, unitPrice } of itemUpdates) {
    await prisma.orderItem.update({ where: { id }, data: { quantity, unitPrice } })
  }
  if (removedItemIds.length > 0) {
    await prisma.orderItem.deleteMany({ where: { id: { in: removedItemIds } } })
  }
  if (newItems.length > 0) {
    await prisma.orderItem.createMany({ data: newItems.map((item) => ({ ...item, orderId })) })
  }
  if (newDeliveryDate) {
    await prisma.order.update({ where: { id: orderId }, data: { deliveryDate: newDeliveryDate } })
  }
  await prisma.orderEditLog.create({ data: { orderId, changes } })

  // Reconcilia todo (productId, colorComboKey) distinto tocado pela
  // sessão -- itens editados, removidos e novos (mesmo padrão de
  // reconcileDistinctPairs, só que por cima dos 3 grupos de uma vez).
  const touched = new Map<string, { productId: string; colorComboKey: string | null }>()
  for (const { id } of itemUpdates) {
    const item = itemById.get(id)!
    touched.set(`${item.productId}::${item.colorComboKey ?? ''}`, item)
  }
  for (const id of removedItemIds) {
    const item = itemById.get(id)!
    touched.set(`${item.productId}::${item.colorComboKey ?? ''}`, item)
  }
  for (const item of newItems) {
    touched.set(`${item.productId}::${item.colorComboKey ?? ''}`, item)
  }
  const reallocations: OrderReallocationEvent[] = []
  for (const { productId, colorComboKey } of touched.values()) {
    reallocations.push(...(await reconcileOrderReservations(productId, colorComboKey)))
  }

  const remaining = await prisma.orderItem.findMany({ where: { orderId }, select: { status: true } })
  if (areAllItemsTerminal(remaining.map((r) => r.status))) {
    const inbox = await prisma.marketplaceOrderInbox.findUnique({ where: { confirmedOrderId: orderId } })
    if (inbox) await resolveNotificationsForResource('MarketplaceOrderInbox', inbox.id)
  }

  revalidatePath('/orders')
  revalidatePath('/stock')
  revalidatePath('/production')
  revalidatePath('/assembly')
  return { success: true, reallocations }
}

// Redesign "Pedidos" -- seção "Histórico de alterações" do drawer: 1
// findMany simples ordenado por data, mesmo padrão de
// getStockAdjustmentHistory (actions/stockAdjustments.ts). "Pedido
// criado" nunca é uma linha gravada aqui -- a UI sintetiza essa 1ª
// entrada a partir de `order.createdAt`, já disponível sem query extra.
export async function getOrderEditHistory(orderId: string): Promise<{ id: string; changes: { label: string; from: string; to: string }[]; createdAt: Date }[]> {
  const logs = await prisma.orderEditLog.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } })
  return logs.map((l) => ({ id: l.id, changes: l.changes as { label: string; from: string; to: string }[], createdAt: l.createdAt }))
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
  // Finding 2 (revisão final da integração Mercado Livre): cancela via
  // updateMany direto (não passa por updateOrderItemStatus), então nunca
  // chamava resolveMarketplaceNotificationIfTerminal -- a notificação do
  // sino ficava presa mesmo com o pedido inteiro cancelado. Todo item alvo
  // de UMA chamada de cancelOrder pertence ao MESMO `order` (buscado por id
  // acima), então 1 chamada basta -- `targets.length > 0` já está
  // garantido pelo early-return logo acima.
  await resolveMarketplaceNotificationIfTerminal(order.id, 'CANCELADO')

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
  if (order.items.some((i) => i.consignmentDeliveryId)) {
    return { success: false, error: 'Este pedido já tem item(ns) entregue(s) que viraram entrega de consignação — remova a entrega em Consignação, se necessário.' }
  }
  const pairs = new Map<string, { productId: string; colorComboKey: string | null }>()
  for (const i of order.items) pairs.set(`${i.productId}::${i.colorComboKey ?? ''}`, i)

  // Finding 2 (revisão final da integração Mercado Livre): apagar o Order
  // faz ON DELETE SET NULL em MarketplaceOrderInbox.confirmedOrderId
  // (prisma/schema.prisma) -- depois disso a linha do inbox fica
  // impossível de achar por confirmedOrderId pra sempre, e a notificação
  // vinculada a ela nunca mais resolveria. Busca a linha ANTES do delete
  // (senão a FK já zerou o vínculo e a busca não acharia nada), mas só
  // resolve a notificação DEPOIS que o delete realmente tiver sucesso --
  // se o delete falhar (RESTRICT de OrderReallocation, abaixo) o pedido
  // continua existindo e a notificação não deve ser mexida. O pedido está
  // sendo destruído de vez, então não tem sentido checar terminalidade de
  // item nenhum aqui (nada sobra pra acompanhar).
  const linkedInbox = await prisma.marketplaceOrderInbox.findUnique({ where: { confirmedOrderId: id } })

  try {
    await prisma.order.delete({ where: { id } })
  } catch (err) {
    if (isForeignKeyConstraintError(err)) {
      return { success: false, error: 'Este pedido tem histórico de realocação de peça com outro pedido e não pode ser excluído direto — cancele os itens pendentes primeiro (opção "Cancelar").' }
    }
    throw err
  }

  if (linkedInbox) await resolveNotificationsForResource('MarketplaceOrderInbox', linkedInbox.id)

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

export interface AccessoryDemandRow {
  accessoryId: string
  accessoryName: string
  colorName: string
  colorHex: string | null
  neededUnits: number
  availableUnits: number
  missingUnits: number
  // Contexto de quais pedidos pendentes puxam esse acessório -- não
  // exaustivo por item, só os pedidos distintos (mesmo texto curto do
  // resto da fila de demanda).
  orders: { orderNumber: string | null; buyerOrPlatform: string | null }[]
}

// Pedido do usuário "aviso de acessório insuficiente, como o de produção,
// mas em Produção -- preciso saber ao criar o pedido pra me organizar":
// peça impressa que falta já tem aviso (productionRows acima, "vão pra
// produção") -- acessório (item comprado, nunca entra na fila de
// impressão) não tinha NENHUM, só aparecia faltando na hora de confirmar a
// Montagem. Soma, por acessório REALMENTE escolhido em cada pedido
// pendente (mesma resolução de colorComboKey que confirmAssembly usa --
// choices[u.accessoryId] é o id do acessório-irmão de cor escolhido, senão
// cai no acessório-base da ficha técnica), quanto cada item ainda vai
// consumir (shortfall × quantityPerUnit) -- comparado contra
// Accessory.currentStock AGORA (estoque real, sem reconstruir histórico).
// Só entra na lista quando falta de verdade (missingUnits > 0); link
// "Repor estoque" abre direto o formulário de compra do acessório em
// /accessories (?restock=, mesmo padrão de ?editId= já usado em todo
// catálogo).
export async function getAccessoryDemandQueue(): Promise<AccessoryDemandRow[]> {
  const items = await prisma.orderItem.findMany({
    where: { status: { notIn: ['ENTREGUE', 'CANCELADO'] } },
    include: {
      product: { include: { accessoryUsages: true } },
      order: { select: { orderNumber: true, buyerOrPlatform: true } },
    },
  })
  const pending = items.filter((i) => i.quantity > i.reservedQuantity && i.product.accessoryUsages.length > 0)
  if (pending.length === 0) return []

  const neededByAccessory = new Map<string, { neededUnits: number; orders: Map<string, { orderNumber: string | null; buyerOrPlatform: string | null }> }>()
  for (const item of pending) {
    const shortfall = item.quantity - item.reservedQuantity
    const choices = item.colorComboKey ? deserializeColorChoices(item.colorComboKey) : null
    for (const u of item.product.accessoryUsages) {
      const resolvedAccessoryId = choices?.[u.accessoryId] ?? u.accessoryId
      const neededUnits = shortfall * u.quantity.toNumber()
      if (neededUnits <= 0) continue
      const entry = neededByAccessory.get(resolvedAccessoryId) ?? { neededUnits: 0, orders: new Map() }
      entry.neededUnits += neededUnits
      entry.orders.set(item.orderId, { orderNumber: item.order.orderNumber, buyerOrPlatform: item.order.buyerOrPlatform })
      neededByAccessory.set(resolvedAccessoryId, entry)
    }
  }
  if (neededByAccessory.size === 0) return []

  const accessories = await prisma.accessory.findMany({ where: { id: { in: [...neededByAccessory.keys()] } } })
  const accessoryById = new Map(accessories.map((a) => [a.id, a]))

  const rows: AccessoryDemandRow[] = []
  for (const [accessoryId, { neededUnits, orders }] of neededByAccessory) {
    const accessory = accessoryById.get(accessoryId)
    if (!accessory) continue
    const availableUnits = accessory.currentStock.toNumber()
    const missingUnits = neededUnits - availableUnits
    if (missingUnits <= 0) continue
    rows.push({
      accessoryId,
      accessoryName: accessory.name,
      colorName: accessory.colorName,
      colorHex: accessory.colorHex,
      neededUnits,
      availableUnits,
      missingUnits,
      orders: [...orders.values()],
    })
  }
  return rows.sort((a, b) => b.missingUnits - a.missingUnits)
}

// Redesign "Pedidos" -- "Novo pedido" §1 Cliente: chips dos nomes mais
// recentes/distintos já usados em Order.buyerOrPlatform (texto livre,
// nunca existiu tabela de Cliente -- decisão confirmada com o usuário:
// derivar dos valores já digitados em vez de criar uma entidade nova).
// "+ Novo cliente" continua sendo só digitar um nome novo, que vira o
// texto do próximo pedido, exatamente como já funciona hoje.
export async function getRecentOrderBuyers(limit = 6): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: { buyerOrPlatform: { not: null } },
    select: { buyerOrPlatform: true },
    distinct: ['buyerOrPlatform'],
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.map((r) => r.buyerOrPlatform!).filter(Boolean)
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
