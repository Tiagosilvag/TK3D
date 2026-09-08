import { z } from 'zod'

// Spec §5.4 -- classifies the waste of a production run as a whole (1 reason
// per record, ledger of multiple events is an explicit non-objective).
export const wasteReasonEnum = z.enum([
  'FALHA_IMPRESSAO',
  'ERRO_CONFIGURACAO',
  'SUPORTE_EXCESSIVO',
  'QUEBRA',
  'TESTE',
  'PURGA',
  'TROCA_FILAMENTO',
  'OUTRO',
])

export const productionRunSchema = z.object({
  productId: z.string().min(1),
  printerId: z.string().min(1),
  filamentId: z.string().min(1),
  date: z.coerce.date(),
  quantityPlanned: z.coerce.number().int('Quantidade planejada deve ser um número inteiro').positive('Quantidade planejada deve ser maior que zero'),
  quantitySuccess: z.coerce.number().int('Quantidade de sucesso deve ser um número inteiro').nonnegative('Quantidade de sucesso não pode ser negativa'),
  quantityFailed: z.coerce.number().int('Quantidade de falhas deve ser um número inteiro').nonnegative('Quantidade de falhas não pode ser negativa'),
  gramsUsed: z.coerce.number({ invalid_type_error: 'Peso inválido' }).nonnegative('Não pode ser negativo'),
  gramsWasted: z.coerce.number().nonnegative('Gramas desperdiçadas não pode ser negativo'),
  timeWastedHours: z.coerce.number().nonnegative('Tempo desperdiçado não pode ser negativo'),
  wasteReason: wasteReasonEnum.nullable().optional(),
  notes: z.string().optional().nullable(),
}).refine((data) => data.quantitySuccess + data.quantityFailed <= data.quantityPlanned, {
  message: 'Sucesso + falhas não pode ser maior que o planejado',
  path: ['quantityFailed'],
})

// Edição de uma produção já registrada (spec do módulo Produção): quantidade
// e filamento ficam sempre somente leitura para preservar integridade
// histórica -- só os campos de desperdício e observações podem mudar,
// qualquer que seja o status (exceto Cancelada, que não é editável).
export const productionRunWasteUpdateSchema = z.object({
  gramsWasted: z.coerce.number().nonnegative('Gramas desperdiçadas não pode ser negativo'),
  timeWastedHours: z.coerce.number().nonnegative('Tempo desperdiçado não pode ser negativo'),
  wasteReason: wasteReasonEnum.nullable().optional(),
  notes: z.string().optional().nullable(),
})
