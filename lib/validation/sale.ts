import { z } from 'zod'

export const saleSchema = z.object({
  channel: z.enum(['DIRETA', 'MARKETPLACE'], { errorMap: () => ({ message: 'Selecione um canal' }) }),
  productId: z.string().min(1, 'Selecione um produto'),
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  unitPrice: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor deve ser maior que zero'),
  saleDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  buyerOrPlatform: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})
