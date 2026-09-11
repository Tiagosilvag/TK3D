import { z } from 'zod'

export const finishingTypeEnum = z.enum(['NENHUM', 'CANETA_VERNIZ', 'RESINA_UV', 'OUTRO'])

// z.coerce.boolean() would turn the string "false" into `true` (any
// non-empty string is truthy), which breaks both the literal "false" value
// sent by tests/forms and an unchecked HTML checkbox that is simply absent
// from the FormData. Only "true"/"on" (the value a checked checkbox sends)
// count as true; everything else, including absence, is false.
const checkboxBoolean = z.string().optional().transform((v) => v === 'true' || v === 'on')

// Ajuste "peça multi-filamento": um componente de filamento da receita de
// uma peça -- a maioria das peças tem só 1, mas uma impressão
// multi-material pode precisar de várias cores ao mesmo tempo.
export const productPartFilamentSchema = z.object({
  filamentId: z.string().min(1, 'Selecione um filamento'),
  weightGrams: z.coerce.number().positive('Peso deve ser maior que zero'),
})

export type ProductPartFilamentInput = z.infer<typeof productPartFilamentSchema>

// 2.1 Produto composto (BOM): uma peça da lista de partes de um produto
// composto. `id` presente = editar essa peça existente; ausente = peça
// nova (actions/products.ts decide create vs update por isso).
export const productPartSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Nome da peça é obrigatório'),
  printerId: z.string().min(1, 'Selecione uma impressora'),
  filaments: z.array(productPartFilamentSchema).min(1, 'Adicione ao menos um filamento'),
  printTimeHours: z.coerce.number().positive('Tempo de impressão deve ser maior que zero'),
  quantityPerUnit: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
})

export type ProductPartInput = z.infer<typeof productPartSchema>

// printerId/filamentId/weightGrams/printTimeHours só são obrigatórios pra
// produto SIMPLES (isComposite=false) -- pra composto, `parts` é que é
// obrigatório (ao menos 1 peça). Ver o superRefine abaixo.
export const productSchema = z
  .object({
    name: z.string().min(1, 'Nome é obrigatório'),
    category: z.string().min(1, 'Selecione a categoria'),
    isComposite: checkboxBoolean,
    printerId: z.string().optional().nullable(),
    filamentId: z.string().optional().nullable(),
    weightGrams: z.coerce.number().optional(),
    printTimeHours: z.coerce.number().optional(),
    laborTimeHours: z.coerce.number().nonnegative('Tempo de mão de obra não pode ser negativo'),
    finishingType: finishingTypeEnum,
    usesGlue: checkboxBoolean,
    notes: z.string().optional().nullable(),
    parts: z.array(productPartSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isComposite) {
      if (!data.parts || data.parts.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Adicione ao menos uma peça', path: ['parts'] })
      }
    } else {
      if (!data.printerId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecione uma impressora', path: ['printerId'] })
      if (!data.filamentId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecione um filamento', path: ['filamentId'] })
      if (data.weightGrams == null || !(data.weightGrams > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Peso deve ser maior que zero', path: ['weightGrams'] })
      }
      if (data.printTimeHours == null || !(data.printTimeHours > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tempo de impressão deve ser maior que zero', path: ['printTimeHours'] })
      }
    }
  })

export type ProductInput = z.infer<typeof productSchema>
