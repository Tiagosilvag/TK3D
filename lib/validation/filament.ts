import { z } from 'zod'

export const filamentSchema = z.object({
  manufacturer: z.string().min(1, 'Marca/fabricante é obrigatório'),
  material: z.enum(['PLA', 'PETG', 'TPU', 'OUTRO'], { errorMap: () => ({ message: 'Selecione um material' }) }),
  colorName: z.string().min(1, 'Nome da cor é obrigatório'),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
  spoolWeightKg: z.coerce.number({ invalid_type_error: 'Peso inválido' }).positive('Peso deve ser maior que zero'),
  spoolPrice: z.coerce.number({ invalid_type_error: 'Preço inválido' }).positive('Preço deve ser maior que zero'),
})

export type FilamentInput = z.infer<typeof filamentSchema>
