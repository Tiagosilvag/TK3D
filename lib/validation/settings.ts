import { z } from 'zod'

const percent = () => z.coerce.number().min(0, 'Valor não pode ser negativo').max(1, 'Valor não pode ser maior que 100%')

export const settingsSchema = z.object({
  energyCostPerKwh: z.coerce.number().positive('Custo de energia deve ser maior que zero'),
  laborCostPerHour: z.coerce.number().positive('Custo de mão de obra deve ser maior que zero'),
  failureRatePercent: percent(),
  marketplaceFeePercent: percent(),
  taxPercent: percent(),
  marketplaceFixedFee: z.coerce.number().nonnegative('Taxa fixa não pode ser negativa'),
  defaultMarkup: z.coerce.number().positive('Markup deve ser maior que zero'),
})

export type SettingsInput = z.infer<typeof settingsSchema>
