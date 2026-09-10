import { z } from 'zod'

export const printerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  nickname: z.string().optional().nullable(),
  purchasePrice: z.coerce.number().positive('Preço deve ser maior que zero'),
  depreciationHours: z.coerce.number().positive('Horas de depreciação deve ser maior que zero'),
  avgPowerConsumptionKwh: z.coerce.number().positive('Consumo médio deve ser maior que zero'),
  energyCostPerKwh: z.coerce.number().nonnegative('Tarifa de energia não pode ser negativa'),
  maintenanceCostPerHour: z.coerce.number().nonnegative('Manutenção estimada não pode ser negativa'),
})

export type PrinterInput = z.infer<typeof printerSchema>
