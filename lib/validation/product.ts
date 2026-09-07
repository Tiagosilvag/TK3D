import { z } from 'zod'

export const finishingTypeEnum = z.enum(['NENHUM', 'CANETA_VERNIZ', 'RESINA_UV', 'OUTRO'])

export const productSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  category: z.string().min(1).default('Chaveiro'),
  printerId: z.string().min(1, 'Selecione uma impressora'),
  filamentId: z.string().min(1, 'Selecione um filamento'),
  weightGrams: z.coerce.number().positive(),
  printTimeHours: z.coerce.number().positive(),
  laborTimeHours: z.coerce.number().nonnegative(),
  packagingItemId: z.string().optional().nullable(),
  accessoryId: z.string().optional().nullable(),
  finishingType: finishingTypeEnum,
  // z.coerce.boolean() would turn the string "false" into `true` (any
  // non-empty string is truthy), which breaks both the literal "false" value
  // sent by tests/forms and an unchecked HTML checkbox that is simply absent
  // from the FormData. Only "true"/"on" (the value a checked checkbox sends)
  // count as true; everything else, including absence, is false.
  usesGlue: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === 'on'),
  notes: z.string().optional().nullable(),
})

export type ProductInput = z.infer<typeof productSchema>
