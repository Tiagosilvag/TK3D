import { z } from 'zod'

export const consignmentPartnerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  defaultCommissionPercent: z.coerce.number().min(0, 'Comissão não pode ser negativa').max(1, 'Comissão não pode ser maior que 100%'),
  notes: z.string().optional().nullable(),
})

export type ConsignmentPartnerInput = z.infer<typeof consignmentPartnerSchema>

export const consignmentDeliverySchema = z.object({
  partnerId: z.string().min(1, 'Selecione um parceiro'),
  productId: z.string().min(1, 'Selecione um produto'),
  quantityDelivered: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  unitPrice: z.coerce.number().positive('Preço unitário deve ser maior que zero'),
  deliveryDate: z.coerce.date(),
  // Melhoria "Parceiros de consignação" §5: comboKey da variante entregue
  // (mesma convenção de ProductAssembly.colorChoices) -- opcional porque
  // produto sem variante conhecida (getProductVariantBreakdown vazio) não
  // tem o que escolher.
  colorComboKey: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export type ConsignmentDeliveryInput = z.infer<typeof consignmentDeliverySchema>

// Melhoria "Entregas em consignação" §3: uma submissão do modal "Registrar
// entrega" cria N linhas ConsignmentDelivery (uma por produto+cor) de uma
// vez, todas compartilhando o mesmo batchId -- partnerId/deliveryDate/notes
// ficam no nível do lote (uma entrega = um parceiro, uma data), quantidade/
// preço/cor ficam por item.
export const consignmentDeliveryBatchItemSchema = z.object({
  productId: z.string().min(1, 'Selecione um produto'),
  colorComboKey: z.string().optional().nullable(),
  quantityDelivered: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  unitPrice: z.coerce.number().positive('Preço unitário deve ser maior que zero'),
})

export const consignmentDeliveryBatchSchema = z.object({
  partnerId: z.string().min(1, 'Selecione um parceiro'),
  deliveryDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
  items: z.array(consignmentDeliveryBatchItemSchema).min(1, 'Adicione pelo menos um produto'),
})

export type ConsignmentDeliveryBatchInput = z.infer<typeof consignmentDeliveryBatchSchema>

// The balance check (quantitySold <= quantityDelivered - alreadySold) cannot
// live here: it depends on a database query (the delivery's existing sale
// reports), which pure Zod schemas cannot perform. That check is done in the
// createConsignmentSaleReport server action instead.
export const consignmentSaleReportSchema = z.object({
  deliveryId: z.string().min(1, 'Selecione uma entrega'),
  quantitySold: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  reportDate: z.coerce.date(),
  commissionPercent: z.coerce.number().min(0, 'Comissão não pode ser negativa').max(1, 'Comissão não pode ser maior que 100%'),
  notes: z.string().optional().nullable(),
})

export type ConsignmentSaleReportInput = z.infer<typeof consignmentSaleReportSchema>
