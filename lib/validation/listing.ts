import { z } from 'zod'

// Mesmo idioma de lib/validation/product.ts -- z.coerce.boolean() trata
// qualquer string não-vazia (inclusive "false") como true, o que quebra
// um checkbox desmarcado (ausente do FormData) ou um "false" literal.
const checkboxBoolean = z.string().optional().transform((v) => v === 'true' || v === 'on')

// Anúncios: vínculo Produto × Plataforma (ver Listing em schema.prisma).
// listingType só faz sentido pra Mercado Livre -- a checagem de "não pode
// vir preenchido numa plataforma que não seja ML" é feita pela action
// (createListing/updateListing), que já sabe qual é o `platform.platform`
// resolvido a partir de `platformId`, informação que este schema puro não
// tem acesso.
export const listingSchema = z.object({
  productId: z.string().min(1, 'Produto é obrigatório'),
  platformId: z.string().min(1, 'Plataforma é obrigatória'),
  listingType: z.enum(['CLASSICO', 'PREMIUM']).optional().nullable(),
  status: z.enum(['RASCUNHO', 'ONLINE', 'PAUSADO']),
  price: z.coerce.number({ invalid_type_error: 'Preço inválido' }).positive('Preço deve ser maior que zero'),
  freightType: z.enum(['GRATIS_SUBSIDIADO', 'PAGO_COMPRADOR', 'PERSONALIZADO']),
  freightCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo'),
  hasGift: checkboxBoolean,
  giftCost: z.coerce.number({ invalid_type_error: 'Valor inválido' }).min(0, 'Valor não pode ser negativo').optional().default(0),
  listingUrl: z.union([z.literal(''), z.string().url('Link inválido')]).optional().transform((v) => (v ? v : null)),
})

export type ListingInput = z.infer<typeof listingSchema>
