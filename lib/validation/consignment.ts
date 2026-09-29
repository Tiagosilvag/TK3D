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
  // Melhoria "Registrar venda": preço unitário desta venda, quando diferente
  // do cadastrado na entrega -- ausente/vazio usa delivery.unitPrice (ver
  // ConsignmentSaleReport.unitPrice no schema).
  unitPrice: z.coerce.number().positive('Preço deve ser maior que zero').optional().nullable(),
  notes: z.string().optional().nullable(),
})

// Melhoria "Registrar venda" (parceiros de consignação): "selecionar todos
// os produtos entregues e disponíveis pra lançar a venda de uma vez" --
// mesmo padrão de lote de productionRunBatchSchema (checkbox por linha no
// modal, 1 submissão cria N ConsignmentSaleReport). reportDate/notes são
// únicos pro lote inteiro (mesma data de registro pra tudo que a pessoa
// marcou); cada item mantém sua própria quantidade/comissão (a comissão
// pode variar por entrega se o parceiro tiver combinado algo diferente
// daquela vez).
//
// Bug "2 entregas do mesmo produto+cor apareciam como 2 linhas em vez de 1
// com o saldo somado": um item agora representa um GRUPO produto+cor
// (ConsignmentSaleableDelivery, lib/reports.ts), não mais uma entrega
// única -- `deliveryIds` traz as entregas que compõem esse grupo (mais
// antiga primeiro); createConsignmentSaleReportBatch consome nessa ordem
// (FIFO) até cobrir quantitySold, criando 1 ConsignmentSaleReport por
// entrega efetivamente tocada.
export const consignmentSaleReportBatchItemSchema = z.object({
  deliveryIds: z.array(z.string().min(1)).min(1, 'Selecione ao menos uma entrega'),
  quantitySold: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  commissionPercent: z.coerce.number().min(0, 'Comissão não pode ser negativa').max(1, 'Comissão não pode ser maior que 100%'),
  // Preço unitário desta venda -- sempre gravado explicitamente em cada
  // ConsignmentSaleReport gerado (nunca null/"herda da entrega"), já que 1
  // grupo pode abranger entregas com preços cadastrados diferentes entre
  // si (ver comentário de ConsignmentSaleableDelivery.unitPrice).
  unitPrice: z.coerce.number().positive('Preço deve ser maior que zero'),
})

export const consignmentSaleReportBatchSchema = z.object({
  reportDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
  items: z.array(consignmentSaleReportBatchItemSchema).min(1, 'Marque ao menos um produto'),
})

export type ConsignmentSaleReportInput = z.infer<typeof consignmentSaleReportSchema>
