import { z } from 'zod'

export const orderChannelEnum = z.enum(['DIRETA', 'SHOPEE', 'MERCADO_LIVRE'])
export const orderStatusEnum = z.enum(['RECEBIDO', 'EM_PRODUCAO', 'PRONTO', 'DESPACHADO', 'CONCLUIDO'])

export const orderSchema = z.object({
  channel: orderChannelEnum,
  productId: z.string().min(1, 'Selecione um produto'),
  quantity: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  unitPrice: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor deve ser maior que zero'),
  orderDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  orderNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export type OrderInput = z.infer<typeof orderSchema>
