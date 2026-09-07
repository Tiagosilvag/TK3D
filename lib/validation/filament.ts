import { z } from 'zod'

export const filamentSchema = z.object({
  manufacturer: z.string().min(1, 'Nome/fabricante é obrigatório'),
  diameterMm: z.coerce.number().positive('Diâmetro deve ser maior que zero'),
  spoolPrice: z.coerce.number().positive('Preço do rolo deve ser maior que zero'),
  spoolWeightKg: z.coerce.number().positive('Peso do rolo deve ser maior que zero'),
  densityGCm3: z.coerce.number().positive('Densidade deve ser maior que zero'),
  nozzleTempC: z.coerce.number().int('Temperatura do bico deve ser um número inteiro').positive('Temperatura do bico deve ser maior que zero'),
  bedTempC: z.coerce.number().int('Temperatura da mesa deve ser um número inteiro').nonnegative('Temperatura da mesa não pode ser negativa'),
})

export type FilamentInput = z.infer<typeof filamentSchema>
