import { z } from 'zod'

export const consignmentPartnerSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  defaultCommissionPercent: z.coerce.number().min(0).max(1),
  notes: z.string().optional().nullable(),
})

export type ConsignmentPartnerInput = z.infer<typeof consignmentPartnerSchema>

export const consignmentDeliverySchema = z.object({
  partnerId: z.string().min(1, 'Selecione um parceiro'),
  productId: z.string().min(1, 'Selecione um produto'),
  quantityDelivered: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().positive(),
  deliveryDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
})

export type ConsignmentDeliveryInput = z.infer<typeof consignmentDeliverySchema>

// The balance check (quantitySold <= quantityDelivered - alreadySold) cannot
// live here: it depends on a database query (the delivery's existing sale
// reports), which pure Zod schemas cannot perform. That check is done in the
// createConsignmentSaleReport server action instead.
export const consignmentSaleReportSchema = z.object({
  deliveryId: z.string().min(1, 'Selecione uma entrega'),
  quantitySold: z.coerce.number().int().positive(),
  reportDate: z.coerce.date(),
  commissionPercent: z.coerce.number().min(0).max(1),
  notes: z.string().optional().nullable(),
})

export type ConsignmentSaleReportInput = z.infer<typeof consignmentSaleReportSchema>
