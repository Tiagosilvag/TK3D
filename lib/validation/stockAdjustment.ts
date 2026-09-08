import { z } from 'zod'

export const stockAdjustmentResourceTypeEnum = z.enum(['FILAMENT', 'ACCESSORY', 'SUPPLY', 'PRODUCT'])
export const stockAdjustmentReasonEnum = z.enum([
  'INVENTARIO_FISICO',
  'PERDA_DANO',
  'PERDA_FALHA_IMPRESSAO',
  'PRODUTO_VENCIDO',
  'CORRECAO_CADASTRO',
  'CONSUMO_NAO_REGISTRADO',
  'OUTRO',
])

export const stockAdjustmentSchema = z
  .object({
    resourceType: stockAdjustmentResourceTypeEnum,
    resourceId: z.string().min(1),
    newQty: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).nonnegative('Quantidade não pode ser negativa'),
    reason: stockAdjustmentReasonEnum,
    reasonNote: z.string().optional().nullable(),
  })
  .refine((data) => data.reason !== 'OUTRO' || Boolean(data.reasonNote?.trim()), {
    message: 'Descreva o motivo',
    path: ['reasonNote'],
  })

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>
