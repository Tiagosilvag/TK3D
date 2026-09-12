import { z } from 'zod'

// Mesmo padrão de lib/validation/settings.ts#checkbox: z.coerce.boolean()
// trataria a string "false" como truthy (qualquer string não-vazia vira
// true) -- só "true"/"on" (o que um checkbox marcado manda) contam.
const checkbox = () =>
  z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === 'on')

export const printerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  nickname: z.string().optional().nullable(),
  purchasePrice: z.coerce.number().positive('Preço deve ser maior que zero'),
  depreciationHours: z.coerce.number().positive('Horas de depreciação deve ser maior que zero'),
  avgPowerConsumptionKwh: z.coerce.number().positive('Consumo médio deve ser maior que zero'),
  energyCostPerKwh: z.coerce.number().nonnegative('Tarifa de energia não pode ser negativa'),
  maintenanceCostPerHour: z.coerce.number().nonnegative('Manutenção estimada não pode ser negativa'),
  bambuEnabled: checkbox(),
  bambuSerial: z.string().optional().nullable(),
  anycubicEnabled: checkbox(),
  anycubicPrinterKey: z.string().optional().nullable(),
})

export type PrinterInput = z.infer<typeof printerSchema>
