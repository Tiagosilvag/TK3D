import { z } from 'zod'

const percent = () => z.coerce.number().min(0).max(1)

export const settingsSchema = z.object({
  energyCostPerKwh: z.coerce.number().positive(),
  laborCostPerHour: z.coerce.number().positive(),
  failureRatePercent: percent(),
  marketplaceFeePercent: percent(),
  taxPercent: percent(),
  marketplaceFixedFee: z.coerce.number().nonnegative(),
  defaultMarkup: z.coerce.number().positive(),
})

export type SettingsInput = z.infer<typeof settingsSchema>
