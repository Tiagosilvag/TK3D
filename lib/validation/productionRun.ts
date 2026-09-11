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

// Ajuste "peça multi-filamento": consumo real de UM componente de filamento
// da receita, quando a peça produzida tem mais de 1 (impressão
// multi-material). filamentId/gramsUsed/gramsWasted no nível do
// ProductionRun (abaixo) recebem o AGREGADO desta lista (1º componente pro
// filamentId "principal", soma pra gramsUsed/gramsWasted) -- actions/
// productionRuns.ts é quem monta esse agregado antes de validar.
export const productionRunFilamentUsageSchema = z.object({
  filamentId: z.string().min(1),
  gramsUsed: z.coerce.number({ invalid_type_error: 'Peso inválido' }).nonnegative('Não pode ser negativo'),
  gramsWasted: z.coerce.number().nonnegative('Gramas desperdiçadas não pode ser negativo'),
})

export const productionRunSchema = z.object({
  productId: z.string().min(1),
  // 2.1 Produto composto: presente quando esta produção é de uma peça
  // específica (não do produto pronto) -- ausente/vazio pra produto simples.
  productPartId: z.string().optional().nullable(),
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
  // Presente só quando a peça produzida tem >1 componente de filamento --
  // ver comentário acima.
  filamentUsages: z.array(productionRunFilamentUsageSchema).min(1).optional(),
}).refine((data) => data.quantitySuccess + data.quantityFailed <= data.quantityPlanned, {
  message: 'Sucesso + falhas não pode ser maior que o planejado',
  path: ['quantityFailed'],
})

// Melhoria "Produção" §3: um item do lote do modal "Registrar produção" --
// uma peça marcada (ou a linha única de um produto simples), com sua
// própria impressora/filamento(s)/peso-por-unidade/tempo, já pré-
// preenchidos da ficha técnica mas editáveis. `quantityFailed` NÃO faz
// parte deste schema de propósito -- é sempre "Falhas (auto)" no modal
// (planejada − sucesso), recalculado no server em createProductionRunBatch,
// nunca confiado do cliente.
export const productionRunBatchItemFilamentSchema = z.object({
  filamentId: z.string().min(1),
  weightGramsPerUnit: z.coerce.number({ invalid_type_error: 'Peso inválido' }).nonnegative('Não pode ser negativo'),
  gramsWasted: z.coerce.number().nonnegative('Gramas desperdiçadas não pode ser negativo').default(0),
})

export const productionRunBatchItemSchema = z.object({
  // Presente pra peça de produto composto; ausente pra linha única de um
  // produto simples (mesma convenção de productionRunSchema acima).
  productPartId: z.string().optional().nullable(),
  printerId: z.string().min(1),
  quantityPlanned: z.coerce.number().int('Quantidade planejada deve ser um número inteiro').positive('Quantidade planejada deve ser maior que zero'),
  quantitySuccess: z.coerce.number().int('Quantidade de sucesso deve ser um número inteiro').nonnegative('Quantidade de sucesso não pode ser negativa'),
  // 1 item pra peça de cor única (a maioria) ou produto simples; >1 pra
  // peça multi-filamento (mesma receita de ProductPartFilament).
  filaments: z.array(productionRunBatchItemFilamentSchema).min(1, 'Selecione ao menos um filamento'),
  timeWastedHours: z.coerce.number().nonnegative('Tempo desperdiçado não pode ser negativo').default(0),
  wasteReason: wasteReasonEnum.nullable().optional(),
  notes: z.string().optional().nullable(),
}).refine((item) => item.quantitySuccess <= item.quantityPlanned, {
  message: 'Sucesso não pode ser maior que o planejado',
  path: ['quantitySuccess'],
})

export const productionRunBatchSchema = z.object({
  productId: z.string().min(1),
  date: z.coerce.date(),
  items: z.array(productionRunBatchItemSchema).min(1, 'Marque ao menos uma peça'),
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
