import { z } from 'zod'

// Melhorias "Embalagens": cadastro de PackagingItem NOVO = a primeira
// compra (mesmo padrão de Accessory/Supply, actions/accessories.ts) --
// nome + quantidade + valor total da primeira compra; createPackagingItem
// deriva currentStock/avgUnitCost via calculateWeightedAverageCost a
// partir de estoque zerado. minStock é limiar absoluto (unidades) --
// abaixo dele o item aparece como "Estoque baixo".
export const packagingItemSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).positive('Unidades compradas deve ser maior que zero'),
  totalCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor total pago deve ser maior que zero'),
  minStock: z.coerce.number({ invalid_type_error: 'Estoque mínimo inválido' }).nonnegative('Estoque mínimo não pode ser negativo'),
})

export type PackagingItemInput = z.infer<typeof packagingItemSchema>

// Corrige nome/limiar de um PackagingItem já existente -- nunca estoque ou
// custo, que só mudam por uma compra real (createPackagingItem/
// registerPackagingPurchase), mesmo contrato de updateAccessory.
export const packagingItemUpdateSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  minStock: z.coerce.number({ invalid_type_error: 'Estoque mínimo inválido' }).nonnegative('Estoque mínimo não pode ser negativo'),
})

export type PackagingItemUpdateInput = z.infer<typeof packagingItemUpdateSchema>

// "Repor estoque" -- nova PackagingItemPurchase pra um item já existente.
export const packagingPurchaseSchema = z.object({
  packagingItemId: z.string().min(1, 'Selecione uma embalagem'),
  quantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).positive('Quantidade deve ser maior que zero'),
  totalCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Valor total deve ser maior que zero'),
})

export type PackagingPurchaseInput = z.infer<typeof packagingPurchaseSchema>
