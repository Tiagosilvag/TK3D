import { z } from 'zod'

// "Cadastrar como produto" (calculadora rápida): schema próprio, mais
// permissivo que productSchema (lib/validation/product.ts) -- o objetivo
// aqui é persistir rápido o que a calculadora já tem calculado, sem reabrir
// todo o formulário completo de produto. printerId nulo = usuário deixou a
// seleção padrão "Impressora Média" (actions/quickCalculator.ts resolve pra
// uma Printer real, get-or-create, antes de gravar o Product).
export const quickCalcUsageSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().positive('Quantidade deve ser maior que zero'),
})

// Melhoria "Calculadora rápida multi-filamento": filamentId/weightGrams
// únicos viraram filamentComponents (mesma mudança ProductPart/
// ProductPartFilament já fez pro formulário completo de produto) -- pelo
// menos 1 componente sempre exigido.
export const quickCalcFilamentComponentSchema = z.object({
  filamentId: z.string().min(1),
  weightGrams: z.number().positive('Peso deve ser maior que zero'),
})

export const quickCalcProductSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  category: z.string().min(1, 'Selecione a categoria'),
  filamentComponents: z.array(quickCalcFilamentComponentSchema).min(1, 'Selecione ao menos um filamento'),
  printerId: z.string().min(1).nullable(),
  printTimeHours: z.number().positive('Tempo de impressão deve ser maior que zero'),
  laborTimeHours: z.number().nonnegative('Tempo de mão de obra não pode ser negativo'),
  supplyUsages: z.array(quickCalcUsageSchema),
  accessoryUsages: z.array(quickCalcUsageSchema),
})

export type QuickCalcProductInput = z.infer<typeof quickCalcProductSchema>
