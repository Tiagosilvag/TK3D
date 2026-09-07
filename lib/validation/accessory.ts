import { z } from 'zod'

export const accessoryTypeEnum = z.enum(['CORRENTE_BOLINHA', 'CORRENTE_ELO', 'MOSQUETAO', 'CLICKER', 'OUTRO'])

// colorHex accepts either "" (no color chosen, common for a generic/no-color
// accessory) or a real #rrggbb value -- never both required, since Accessory
// stock is independent per color but color itself is optional (colorName
// defaults to "" in the schema for "sem cor / genérico", spec §1.1).
const colorHexField = z
  .union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')])
  .optional()
  .transform((v) => (v ? v : null))

// Cadastro de um Accessory NOVO = a primeira compra (task-3 brief): nome +
// tipo + cor (opcional) + quantidade + valor total da primeira compra.
// createAccessory derives avgUnitCost/currentStock from quantity/totalCost
// via calculateWeightedAverageCost (lib/costing.ts) starting from a zeroed
// stock -- this schema only validates the raw input.
export const accessorySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  type: accessoryTypeEnum,
  colorName: z.string().default(''),
  colorHex: colorHexField,
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).positive('Quantidade deve ser maior que zero'),
  totalCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor total deve ser maior que zero'),
  purchaseDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  notes: z.string().optional().nullable(),
})

export type AccessoryInput = z.infer<typeof accessorySchema>

// "Repor estoque" (task-3 brief): a new AccessoryPurchase for an existing
// Accessory. Same quantity/totalCost/purchaseDate/notes shape as the first
// purchase, plus which accessory it applies to.
export const accessoryPurchaseSchema = z.object({
  accessoryId: z.string().min(1, 'Selecione um acessório'),
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).positive('Quantidade deve ser maior que zero'),
  totalCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor total deve ser maior que zero'),
  purchaseDate: z.coerce.date({ errorMap: () => ({ message: 'Data inválida' }) }),
  notes: z.string().optional().nullable(),
})

export type AccessoryPurchaseInput = z.infer<typeof accessoryPurchaseSchema>
