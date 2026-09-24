import { z } from 'zod'

// Melhoria "Estoque de filamento por custo médio ponderado": cadastro de um
// Filament NOVO = a primeira compra (mesmo padrão de accessorySchema) --
// peso comprado (kg) + valor total pago, nunca mais "peso do rolo" +
// "preço do rolo" tratados como se fossem sempre exatamente 1 rolo.
// createFilament deriva avgUnitCostPerGram/currentStockGrams a partir de
// weightKg/totalCost via calculateWeightedAverageCost, partindo de estoque
// zerado -- este schema só valida o input bruto.
export const filamentSchema = z.object({
  manufacturer: z.string().min(1, 'Marca/fabricante é obrigatório'),
  material: z.enum(['PLA', 'PETG', 'TPU', 'OUTRO'], { errorMap: () => ({ message: 'Selecione um material' }) }),
  colorName: z.string().min(1, 'Nome da cor é obrigatório'),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
  weightKg: z.coerce.number({ invalid_type_error: 'Peso inválido' }).positive('Peso deve ser maior que zero'),
  totalCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor total deve ser maior que zero'),
  purchaseDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  notes: z.string().optional().nullable(),
})

export type FilamentInput = z.infer<typeof filamentSchema>

// Corrige metadados (marca/material/cor) de um Filament já existente --
// nunca estoque/custo, que só mudam por uma compra real (createFilament/
// registerFilamentPurchase).
export const filamentUpdateSchema = z.object({
  manufacturer: z.string().min(1, 'Marca/fabricante é obrigatório'),
  material: z.enum(['PLA', 'PETG', 'TPU', 'OUTRO'], { errorMap: () => ({ message: 'Selecione um material' }) }),
  colorName: z.string().min(1, 'Nome da cor é obrigatório'),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
})

export type FilamentUpdateInput = z.infer<typeof filamentUpdateSchema>

// "Repor estoque" -- uma nova FilamentPurchase pra um Filament existente.
// Mesmo formato peso/valor/data/observações da primeira compra, mais qual
// filamento.
export const filamentPurchaseSchema = z.object({
  filamentId: z.string().min(1, 'Selecione um filamento'),
  weightKg: z.coerce.number({ invalid_type_error: 'Peso inválido' }).positive('Peso deve ser maior que zero'),
  totalCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor total deve ser maior que zero'),
  purchaseDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  notes: z.string().optional().nullable(),
})

export type FilamentPurchaseInput = z.infer<typeof filamentPurchaseSchema>
