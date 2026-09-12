import { z } from 'zod'

export const finishingTypeEnum = z.enum(['NENHUM', 'CANETA_VERNIZ', 'RESINA_UV', 'OUTRO'])

// Bug "Expected number, received nan" ao cadastrar produto: o campo Peso
// (g) é um <input type="number">, mas em alguns navegadores/dispositivos
// (locale pt-BR) o usuário consegue digitar vírgula como separador decimal
// (ex.: "59,51") e o valor CRU chega assim no FormData -- z.coerce.number()
// faz `Number("59,51")`, que é NaN, e o Zod recusa com essa mensagem
// críptica. Troca vírgula por ponto antes de coagir pra número, só nos
// campos de peso (onde esse erro foi reportado de verdade) -- não é uma
// varredura em todo `z.coerce.number()` do app, ficaria fora do escopo
// deste bug.
function decimalNumber(schema: z.ZodNumber) {
  return z.preprocess((v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v), schema)
}

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
  weightGrams: decimalNumber(z.number().positive('Peso deve ser maior que zero')),
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
    weightGrams: decimalNumber(z.number()).optional(),
    printTimeHours: z.coerce.number().optional(),
    // Bug "Expected number, received nan" ao criar QUALQUER produto: este
    // campo só aparece no formulário na EDIÇÃO ("Campos opcionais" fica
    // escondido na criação, ver ProductForm.tsx) -- sem `.optional()`
    // aqui, a ausência dele no FormData (undefined) ainda passava pelo
    // coerce (`Number(undefined)` = NaN) e falhava a validação. O
    // comentário em actions/products.ts (baseData) já dizia "continua com
    // o default do schema (0h) quando omitido", mas Product.laborTimeHours
    // NUNCA teve `@default` no schema.prisma -- não existia default
    // nenhum pra "continuar valendo". `.default(0)` aqui é o default de
    // verdade (na validação, não no banco): omitido vira 0 antes mesmo de
    // chegar em actions/products.ts, que continua recebendo sempre um
    // number.
    laborTimeHours: z.coerce.number().nonnegative('Tempo de mão de obra não pode ser negativo').optional().default(0),
    // Acabamento/Usa cola saíram do formulário (nunca mais submetidos) --
    // opcionais aqui só pra não quebrar a validação; actions/products.ts
    // não usa mais nenhum dos dois na escrita (omite dos dois `data:` de
    // create/update, deixando o default do schema valer na criação e o
    // valor já gravado intocado na edição, nunca resetado pra NENHUM/false
    // silenciosamente).
    finishingType: finishingTypeEnum.optional(),
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
