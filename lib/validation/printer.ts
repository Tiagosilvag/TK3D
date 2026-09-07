import { z } from 'zod'

export const printerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  purchasePrice: z.coerce.number().positive('Preço deve ser maior que zero'),
  depreciationHours: z.coerce.number().positive('Horas de depreciação deve ser maior que zero'),
  maintenanceCost: z.coerce.number().nonnegative('Custo de manutenção não pode ser negativo'),
  avgPowerConsumptionKwh: z.coerce.number().positive('Consumo médio deve ser maior que zero'),
})

export type PrinterInput = z.infer<typeof printerSchema>
