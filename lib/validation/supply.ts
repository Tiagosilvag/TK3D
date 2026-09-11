import { z } from 'zod'

export const supplyUnitEnum = z.enum(['UN', 'ML', 'G', 'M', 'OUTRO'])

// Melhoria "Insumos": "Uso padrão" é opcional (insumo cadastrado antes
// dessa melhoria não tem valor, e nada obriga informar um na hora) --
// "" (campo vazio) vira null, valor preenchido precisa ser > 0. Mesmo
// padrão de campo opcional já usado por accessorySchema's colorHexField
// (lib/validation/accessory.ts).
const optionalDefaultUsage = z
  .union([z.literal(''), z.coerce.number({ invalid_type_error: 'Uso padrão inválido' }).positive('Uso padrão deve ser maior que zero')])
  .optional()
  .transform((v) => (v === '' || v == null ? null : v))

// Cadastro de um Supply NOVO = a primeira compra (task-4 brief, mirroring
// task-3's Accessory): nome + unidade + quantidade + valor total da
// primeira compra. createSupply derives avgUnitCost/currentStock from
// quantity/totalCost via calculateWeightedAverageCost (lib/costing.ts)
// starting from a zeroed stock -- this schema only validates the raw input.
export const supplySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  unit: supplyUnitEnum,
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).positive('Quantidade deve ser maior que zero'),
  totalCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor total deve ser maior que zero'),
  purchaseDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  notes: z.string().optional().nullable(),
  defaultUsage: optionalDefaultUsage,
})

export type SupplyInput = z.infer<typeof supplySchema>

// "Repor estoque" (task-4 brief): a new SupplyPurchase for an existing
// Supply. Same quantity/totalCost/purchaseDate/notes shape as the first
// purchase, plus which supply it applies to.
export const supplyPurchaseSchema = z.object({
  supplyId: z.string().min(1, 'Selecione um insumo'),
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).positive('Quantidade deve ser maior que zero'),
  totalCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor total deve ser maior que zero'),
  purchaseDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  notes: z.string().optional().nullable(),
})

export type SupplyPurchaseInput = z.infer<typeof supplyPurchaseSchema>

// Corrige nome/unidade de um Supply já cadastrado -- nunca estoque/custo,
// que só mudam por uma compra real (createSupply/registerSupplyPurchase).
export const supplyUpdateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  unit: supplyUnitEnum,
  defaultUsage: optionalDefaultUsage,
})

export type SupplyUpdateInput = z.infer<typeof supplyUpdateSchema>
