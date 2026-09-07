import { z } from 'zod'

export const filamentSchema = z.object({
  manufacturer: z.string().min(1, 'Nome/fabricante é obrigatório'),
  diameterMm: z.coerce.number().positive(),
  spoolPrice: z.coerce.number().positive(),
  spoolWeightKg: z.coerce.number().positive(),
  densityGCm3: z.coerce.number().positive(),
  nozzleTempC: z.coerce.number().int().positive(),
  bedTempC: z.coerce.number().int().nonnegative(),
})

export type FilamentInput = z.infer<typeof filamentSchema>
