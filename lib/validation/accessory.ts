import { z } from 'zod'

export const accessoryTypeEnum = z.enum(['CORRENTE_BOLINHA', 'CORRENTE_ELO', 'MOSQUETAO', 'CLICKER', 'OUTRO'])

export const accessorySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  type: accessoryTypeEnum,
  unitCost: z.coerce.number().positive('Custo unitário deve ser maior que zero'),
})

export type AccessoryInput = z.infer<typeof accessorySchema>
