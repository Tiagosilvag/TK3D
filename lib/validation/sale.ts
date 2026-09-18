import { z } from 'zod'

// 3.6: plataforma específica obrigatória em vez do genérico "Marketplace" +
// texto livre. MARKETPLACE continua um valor aceito aqui só pra permitir
// editar/salvar vendas já registradas com esse canal legado sem forçá-las a
// reclassificar -- o formulário de venda nova não oferece mais essa opção.
export const saleSchema = z.object({
  channel: z.enum(['DIRETA', 'MARKETPLACE', 'SHOPEE', 'MERCADO_LIVRE'], { errorMap: () => ({ message: 'Selecione uma plataforma' }) }),
  productId: z.string().min(1, 'Selecione um produto'),
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  unitPrice: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor deve ser maior que zero'),
  saleDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  buyerOrPlatform: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Melhoria "Vendas por variante": qual cor foi vendida, quando o produto
  // tem mais de uma variante em estoque -- mesma convenção de comboKey de
  // ConsignmentDelivery.colorComboKey. Opcional/nulo pra produto sem
  // variante conhecida; sem checagem de estoque bloqueante no servidor
  // (mesmo padrão já usado em ConsignmentDelivery -- venda nunca trava por
  // falta de registro de cor).
  colorComboKey: z.string().optional().nullable(),
})

// Melhoria "Vendas: múltiplos produtos numa venda": um item da venda (o que
// varia por produto) -- reaproveita os mesmos validadores de saleSchema
// (.pick), nunca duplicados. Usado por createSaleBatch.
export const saleItemSchema = saleSchema.pick({ productId: true, quantity: true, unitPrice: true, colorComboKey: true })

// Campos de cabeçalho (o que é preenchido uma vez pra venda inteira,
// repetido em toda linha de Sale gravada) + a lista de itens -- mesmo
// padrão de consignmentDeliveryBatchSchema (lib/validation/consignment.ts).
// Brinde (spec "Brinde reciclado no sistema" §2): anexo opcional por LOTE
// (não por item -- é "um mimo pra venda inteira"), mesmo nível de
// channel/saleDate/buyerOrPlatform acima. Os dois campos vêm juntos ou
// nenhum -- .refine abaixo garante isso.
export const saleBatchSchema = saleSchema
  .omit({ productId: true, quantity: true, unitPrice: true, colorComboKey: true })
  .extend({
    items: z.array(saleItemSchema).min(1, 'Adicione pelo menos um produto'),
    giftProductId: z.string().optional(),
    giftQuantity: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero').optional(),
  })
  .refine((data) => Boolean(data.giftProductId) === Boolean(data.giftQuantity), {
    message: 'Selecione o brinde e a quantidade',
    path: ['giftProductId'],
  })
