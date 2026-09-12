import { describe, it, expect } from 'vitest'
import { productSchema, productPartFilamentSchema } from '@/lib/validation/product'

describe('productSchema weightGrams (vírgula decimal)', () => {
  it('aceita peso digitado com vírgula (locale pt-BR)', () => {
    const result = productSchema.safeParse({
      name: 'Bandeja fofa',
      category: 'Decoração',
      isComposite: 'false',
      printerId: 'printer-1',
      filamentId: 'filament-1',
      weightGrams: '59,51',
      printTimeHours: '2.5',
      laborTimeHours: '0',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.weightGrams).toBeCloseTo(59.51, 5)
    }
  })

  it('continua aceitando peso com ponto normalmente', () => {
    const result = productSchema.safeParse({
      name: 'Bandeja fofa',
      category: 'Decoração',
      isComposite: 'false',
      printerId: 'printer-1',
      filamentId: 'filament-1',
      weightGrams: '59.51',
      printTimeHours: '2.5',
      laborTimeHours: '0',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.weightGrams).toBeCloseTo(59.51, 5)
    }
  })
})

describe('productPartFilamentSchema.weightGrams (vírgula decimal)', () => {
  it('aceita peso de componente de peça digitado com vírgula', () => {
    const result = productPartFilamentSchema.safeParse({ filamentId: 'filament-1', weightGrams: '15,25' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.weightGrams).toBeCloseTo(15.25, 5)
    }
  })
})

describe('productSchema laborTimeHours (bug "Expected number, received nan" ao criar produto)', () => {
  it('aceita a criação sem laborTimeHours no FormData (campo só aparece na edição) e default pra 0', () => {
    const result = productSchema.safeParse({
      name: 'Bandeja fofa',
      category: 'Decoração',
      isComposite: 'false',
      printerId: 'printer-1',
      filamentId: 'filament-1',
      weightGrams: '59.51',
      printTimeHours: '2.5',
      // laborTimeHours ausente de propósito -- é exatamente o que
      // ProductForm.tsx envia na criação (campo escondido em "Campos
      // opcionais", só visível na edição).
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.laborTimeHours).toBe(0)
    }
  })

  it('continua aceitando laborTimeHours explícito (edição)', () => {
    const result = productSchema.safeParse({
      name: 'Bandeja fofa',
      category: 'Decoração',
      isComposite: 'false',
      printerId: 'printer-1',
      filamentId: 'filament-1',
      weightGrams: '59.51',
      printTimeHours: '2.5',
      laborTimeHours: '1.5',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.laborTimeHours).toBe(1.5)
    }
  })
})
