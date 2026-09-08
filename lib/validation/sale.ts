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
})
