import { z } from 'zod'

export const productionRunSchema = z.object({
  productId: z.string().min(1),
  printerId: z.string().min(1),
  filamentId: z.string().min(1),
  date: z.coerce.date(),
  quantityPlanned: z.coerce.number().int('Quantidade planejada deve ser um número inteiro').positive('Quantidade planejada deve ser maior que zero'),
  quantitySuccess: z.coerce.number().int('Quantidade de sucesso deve ser um número inteiro').nonnegative('Quantidade de sucesso não pode ser negativa'),
  quantityFailed: z.coerce.number().int('Quantidade de falhas deve ser um número inteiro').nonnegative('Quantidade de falhas não pode ser negativa'),
  gramsWasted: z.coerce.number().nonnegative('Gramas desperdiçadas não pode ser negativo'),
  timeWastedHours: z.coerce.number().nonnegative('Tempo desperdiçado não pode ser negativo'),
  notes: z.string().optional().nullable(),
}).refine((data) => data.quantitySuccess + data.quantityFailed <= data.quantityPlanned, {
  message: 'Sucesso + falhas não pode ser maior que o planejado',
  path: ['quantityFailed'],
})
