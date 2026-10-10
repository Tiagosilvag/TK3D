import { z } from 'zod'

export const orderChannelEnum = z.enum(['DIRETA', 'SHOPEE', 'MERCADO_LIVRE', 'CONSIGNADO'])
// Melhoria "Pedidos com reserva de estoque": RECEBIDO/EM_PRODUCAO/PRONTO/
// DESPACHADO/CONCLUIDO ficam listados só porque uma venda antiga ainda
// pode carregar um desses valores (nunca mais escritos por código novo,
// ver comentário no schema.prisma) -- updateOrderItemStatus só aceita
// ENTREGUE de verdade hoje (única transição manual que sobrou; os outros
// status intermediários são derivados por reconcileOrderReservations).
export const orderStatusEnum = z.enum([
  'RECEBIDO',
  'EM_PRODUCAO',
  'PRONTO',
  'DESPACHADO',
  'CONCLUIDO',
  'AGUARDANDO_PRODUCAO',
  'PARCIAL_AGUARDANDO_PRODUCAO',
  'AGUARDANDO_MONTAGEM',
  'PRONTO_RESERVADO',
  'ENTREGUE',
  'CANCELADO',
])

// Melhoria "Pedidos com múltiplos itens": Order virou cabeçalho (preenchido
// uma vez) + N OrderItem (um produto+cor+quantidade+preço cada) -- os dois
// schemas abaixo validam cada metade separadamente. orderItemSchema é
// aplicado item a item (o formulário manda um itemsJson com a lista
// inteira, actions/orders.ts faz o parse + valida cada um).
export const orderHeaderSchema = z
  .object({
    channel: orderChannelEnum,
    orderDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
    // Quando precisa estar pronto/entregue -- decide prioridade entre itens
    // de pedidos diferentes disputando a mesma peça (reconcileOrderReservations).
    deliveryDate: z.coerce.date({ errorMap: () => ({ message: 'Data de entrega inválida' }) }),
    buyerOrPlatform: z.string().optional().nullable(),
    orderNumber: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    // Pedido do usuário "criar pedidos de encomendas de consignados
    // também": obrigatório só pra channel=CONSIGNADO (refine abaixo) --
    // nulo em todo pedido Direta/Shopee/Mercado Livre.
    consignmentPartnerId: z.string().optional().nullable(),
  })
  .refine((data) => data.channel !== 'CONSIGNADO' || !!data.consignmentPartnerId, {
    message: 'Selecione o parceiro de consignação',
    path: ['consignmentPartnerId'],
  })

export const orderItemSchema = z.object({
  productId: z.string().min(1, 'Selecione um produto'),
  // Melhoria "Pedidos com reserva de estoque": mesma convenção de
  // Sale.colorComboKey -- obrigatoriedade condicional (produto com
  // variante) é checada no client, mesmo padrão de requiresColorChoice em
  // SaleForm.tsx, não aqui.
  colorComboKey: z.string().optional().nullable(),
  quantity: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  unitPrice: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor deve ser maior que zero'),
})

export const orderBatchSchema = z.object({
  header: orderHeaderSchema,
  items: z.array(orderItemSchema).min(1, 'Adicione pelo menos um item ao pedido'),
})

// Pedido do usuário "editar item depois de adicionado": só quantidade/
// valor são editáveis num item já salvo (trocar produto/cor exigiria
// recalcular tudo -- fora de escopo, mesma limitação de sempre) -- reusa
// as MESMAS regras de orderItemSchema pros dois campos, nunca duplicadas.
export const updateOrderItemSchema = orderItemSchema.pick({ quantity: true, unitPrice: true })

// Redesign "Pedidos": o drawer de detalhe salva TUDO que mudou numa
// sessão de edição de uma vez só ("Salvar alterações"), não campo a
// campo como updateOrderItem/removeOrderItem faziam -- updateOrderDraft
// (actions/orders.ts) usa estes 3 schemas pros 3 tipos de mudança que
// cabem numa sessão (item existente editado, item novo adicionado, item
// removido), reaproveitando updateOrderItemSchema/orderItemSchema sem
// duplicar as regras de quantidade/valor.
export const orderDraftItemUpdateSchema = updateOrderItemSchema.extend({ id: z.string().min(1) })

export type OrderHeaderInput = z.infer<typeof orderHeaderSchema>
export type OrderItemInput = z.infer<typeof orderItemSchema>
export type OrderBatchInput = z.infer<typeof orderBatchSchema>
export type UpdateOrderItemInput = z.infer<typeof updateOrderItemSchema>
export type OrderDraftItemUpdateInput = z.infer<typeof orderDraftItemUpdateSchema>
