import { z } from 'zod'

export const productionRunSchema = z.object({
  productId: z.string().min(1),
  printerId: z.string().min(1),
  filamentId: z.string().min(1),
  date: z.coerce.date(),
  quantityPlanned: z.coerce.number().int().positive(),
  quantitySuccess: z.coerce.number().int().nonnegative(),
  quantityFailed: z.coerce.number().int().nonnegative(),
  gramsWasted: z.coerce.number().nonnegative(),
  timeWastedHours: z.coerce.number().nonnegative(),
  notes: z.string().optional().nullable(),
}).refine((data) => data.quantitySuccess + data.quantityFailed <= data.quantityPlanned, {
  message: 'Sucesso + falhas não pode ser maior que o planejado',
  path: ['quantityFailed'],
})
