import { z } from 'zod'

export const printerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  purchasePrice: z.coerce.number().positive(),
  depreciationHours: z.coerce.number().positive(),
  maintenanceCost: z.coerce.number().nonnegative(),
  avgPowerConsumptionKwh: z.coerce.number().positive(),
})

export type PrinterInput = z.infer<typeof printerSchema>
