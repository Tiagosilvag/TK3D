import { z } from 'zod'

const percent = () => z.coerce.number().min(0, 'Valor não pode ser negativo').max(1, 'Valor não pode ser maior que 100%')

// Same convention as ProductForm's `usesGlue` (lib/validation/product.ts):
// z.coerce.boolean() would turn the literal string "false" into `true` (any
// non-empty string is truthy), which breaks both an explicit "false" and an
// unchecked HTML checkbox that is simply absent from the FormData. Only
// "true"/"on" (what a checked checkbox sends) count as true.
const checkbox = () =>
  z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === 'on')

export const roundingModeEnum = z.enum(['NONE', 'R90', 'R99', 'R00', 'CUSTOM'])

const baseSettingsSchema = z.object({
  energyCostPerKwh: z.coerce.number().positive('Custo de energia deve ser maior que zero'),
  laborCostPerHour: z.coerce.number().positive('Custo de mão de obra deve ser maior que zero'),
  failureRatePercent: percent(),
  marketplaceFeePercent: percent(),
  taxPercent: percent(),
  marketplaceFixedFee: z.coerce.number().nonnegative('Taxa fixa não pode ser negativa'),
  defaultMarkup: z.coerce.number().positive('Markup deve ser maior que zero'),
  annualMaintenancePercent: percent(),
  annualUsageHours: z.coerce.number().positive('Deve ser maior que zero'),
  // Precificação
  desiredMarginPercent: percent(),
  defaultDiscountPercent: percent(),
  // Estoque (acessórios/insumos — Filamento continua com limiares fixos)
  stockLowThresholdPercent: percent(),
  stockCriticalThresholdPercent: percent(),
  // Melhoria "Meu Estoque" §1/§7: Produto acabado não tem um "estoque
  // inicial"/tamanho de lote de referência (ao contrário de Filamento/
  // Acessório/Insumo) pra calcular um limiar percentual -- é um número
  // absoluto de unidades, direto.
  productLowStockThreshold: z.coerce.number().int('Deve ser um número inteiro').nonnegative('Não pode ser negativo'),
  // Composição do custo — cada flag liga/desliga a contribuição do termo
  // correspondente no subtotal/total de calculateProductCost
  includeDepreciation: checkbox(),
  includeEnergyCost: checkbox(),
  includeMaintenance: checkbox(),
  includeLaborCost: checkbox(),
  includeFailureRate: checkbox(),
  includeFilamentCost: checkbox(),
  includeAccessoriesCost: checkbox(),
  includeSuppliesCost: checkbox(),
  includePackagingCost: checkbox(),
  // Arredondamento do preço final sugerido/marketplace
  roundingMode: roundingModeEnum,
  // Melhoria "Configurações" §7: só exigido/usado quando roundingMode=CUSTOM
  // (refine/transform abaixo) -- os 2 dígitos finais escolhidos (0 a 99).
  roundingCustomCents: z.coerce.number().int('Deve ser um número inteiro').min(0, 'Deve ser entre 0 e 99').max(99, 'Deve ser entre 0 e 99').optional(),
})

export const settingsSchema = baseSettingsSchema
  .refine((data) => data.roundingMode !== 'CUSTOM' || data.roundingCustomCents !== undefined, {
    message: 'Informe os dois dígitos finais para o arredondamento personalizado',
    path: ['roundingCustomCents'],
  })
  .transform((data) => ({
    ...data,
    // Nunca deixa um roundingCustomCents "órfão" de um modo CUSTOM anterior
    // vazando pro modo atual -- só tem valor quando de fato é usado.
    roundingCustomCents: data.roundingMode === 'CUSTOM' ? (data.roundingCustomCents ?? null) : null,
  }))

export type SettingsInput = z.infer<typeof settingsSchema>
