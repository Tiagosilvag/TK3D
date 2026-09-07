import { z } from 'zod'

export const packagingItemSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  unitCost: z.coerce.number().positive(),
})

export type PackagingItemInput = z.infer<typeof packagingItemSchema>
