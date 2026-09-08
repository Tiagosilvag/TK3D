import { z } from 'zod'

export const supplyUnitEnum = z.enum(['UN', 'ML', 'G', 'M', 'OUTRO'])

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
})

export type SupplyUpdateInput = z.infer<typeof supplyUpdateSchema>
