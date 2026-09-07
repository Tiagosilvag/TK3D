import { z } from 'zod'

export const supplyUnitEnum = z.enum(['UN', 'ML', 'G'])

export const supplySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  unit: supplyUnitEnum,
  unitCost: z.coerce.number().nonnegative(),
})

export type SupplyInput = z.infer<typeof supplySchema>
