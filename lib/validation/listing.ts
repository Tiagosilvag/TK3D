import { z } from 'zod'

// Mesmo idioma de lib/validation/product.ts -- z.coerce.boolean() trata
// qualquer string não-vazia (inclusive "false") como true, o que quebra
// um checkbox desmarcado (ausente do FormData) ou um "false" literal.
const checkboxBoolean = z.string().optional().transform((v) => v === 'true' || v === 'on')

// Melhoria "Anúncios: Unidade/Variação/Kit": 1 item de ListingKitItem, já
// resolvido a partir de kitItemsJson (a action monta o array em JS antes
// de passar pro schema -- FormData não carrega estrutura aninhada, mesmo
// padrão de itemsJson em lib/validation/order.ts).
export const listingKitItemSchema = z.object({
  productId: z.string().min(1, 'Produto do kit é obrigatório'),
  quantity: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
})

// Anúncios: vínculo Produto × Plataforma (ver Listing em schema.prisma).
// listingType só faz sentido pra Mercado Livre -- a checagem de "não pode
// vir preenchido numa plataforma que não seja ML" é feita pela action
// (createListing/updateListing), que já sabe qual é o `platform.platform`
// resolvido a partir de `platformId`, informação que este schema puro não
// tem acesso. Mesma lógica pros campos condicionais ao formato
// (productId/includedVariantKeys pra UNIDADE/VARIACAO, kitName/kitItems
// pra KIT) -- exigir aqui precisaria de `.refine` cego ao restante do
// negócio; a action já valida cada caso com a mensagem certa.
export const listingSchema = z.object({
  format: z.enum(['UNIDADE', 'VARIACAO', 'KIT']).default('UNIDADE'),
  productId: z.string().optional().nullable(),
  platformId: z.string().min(1, 'Plataforma é obrigatória'),
  listingType: z.enum(['CLASSICO', 'PREMIUM']).optional().nullable(),
  status: z.enum(['RASCUNHO', 'ONLINE', 'PAUSADO']),
  price: z.coerce.number({ invalid_type_error: 'Preço inválido' }).positive('Preço deve ser maior que zero'),
  freightType: z.enum(['GRATIS_SUBSIDIADO', 'PAGO_COMPRADOR', 'PERSONALIZADO']),
  freightCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo'),
  hasGift: checkboxBoolean,
  giftCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo').optional().default(0),
  listingUrl: z.union([z.literal(''), z.string().url('Link inválido')]).optional().transform((v) => (v ? v : null)),
  // Só formato VARIACAO -- lista de colorComboKey (ver comentário completo
  // em Listing.includedVariantKeys, schema.prisma).
  includedVariantKeys: z.array(z.string().min(1)).optional().nullable(),
  // Só formato KIT.
  kitName: z.string().min(1, 'Nome do kit é obrigatório').optional().nullable(),
  kitItems: z.array(listingKitItemSchema).optional(),
})

export type ListingInput = z.infer<typeof listingSchema>
export type ListingKitItemInput = z.infer<typeof listingKitItemSchema>
