import { describe, it, expect } from 'vitest'
import {
  colorFamily,
  splitColorName,
  toPickerItem,
  matchesFilters,
  groupByFamily,
  stockLevel,
  defaultMaterial,
  type PickerFilters,
  type PickerFilament,
} from '@/lib/filamentPicker'

const base: PickerFilters = { material: 'all', brands: new Set(), finishes: new Set(), query: '', onlyCovering: false, need: 0 }

function fil(id: string, manufacturer: string, material: string, colorName: string, colorHex: string, stockGrams = 500): PickerFilament {
  return { id, manufacturer, material, colorName, colorHex, stockGrams }
}

describe('splitColorName', () => {
  it('separa o acabamento do nome da cor', () => {
    expect(splitColorName('Branco Matte')).toEqual({ color: 'Branco', finish: 'Matte' })
    expect(splitColorName('Dourado Silk')).toEqual({ color: 'Dourado', finish: 'Silk' })
    expect(splitColorName('Vermelho Translúcido')).toEqual({ color: 'Vermelho', finish: 'Translúcido' })
    expect(splitColorName('Marrom escuro')).toEqual({ color: 'Marrom escuro', finish: 'Comum' })
  })
})

describe('colorFamily', () => {
  it('classifica pelo hex', () => {
    expect(colorFamily('#1c1c1c')).toBe('Pretos')
    expect(colorFamily('#f4f4f2')).toBe('Brancos')
    expect(colorFamily('#e03131')).toBe('Vermelhos e rosas')
    expect(colorFamily('#ff4f9a')).toBe('Vermelhos e rosas')
    expect(colorFamily('#f2c200')).toBe('Amarelos e dourados')
    expect(colorFamily('#d4a017')).toBe('Amarelos e dourados')
    expect(colorFamily('#2fa36b')).toBe('Verdes')
    expect(colorFamily('#1f5fe0')).toBe('Azuis')
    expect(colorFamily('#8a2be2')).toBe('Roxos')
    expect(colorFamily('#3b2a22')).toBe('Marrons e tons de pele')
    expect(colorFamily('#f2c9a5')).toBe('Marrons e tons de pele')
    expect(colorFamily('#9a9a9a')).toBe('Cinzas e pratas')
    expect(colorFamily(null)).toBe('Outros')
  })
})

describe('matchesFilters', () => {
  const items = [
    fil('1', 'MASTERPRINT', 'PETG', 'Vermelho', '#e03131'),
    fil('2', 'MASTERPRINT', 'PLA', 'Rosa pink', '#ff4f9a'),
    fil('3', 'ELEGOO', 'PLA', 'Translúcido Azul', '#1f5fe0'),
    fil('4', 'MASTERPRINT', 'PLA', 'Dourado Silk', '#d4a017'),
  ].map(toPickerItem)
  const ids = (f: Partial<PickerFilters>) => items.filter((i) => matchesFilters(i, { ...base, ...f })).map((i) => i.id)

  it('busca ignora acento e caixa; "rosa" não traz vermelhos', () => {
    expect(ids({ query: 'translucido' })).toEqual(['3'])
    expect(ids({ query: 'ROSA' })).toEqual(['2'])
  })
  it('combina várias palavras', () => {
    expect(ids({ query: 'masterprint silk' })).toEqual(['4'])
  })
  it('filtra por tipo, marca e acabamento', () => {
    expect(ids({ material: 'PETG' })).toEqual(['1'])
    expect(ids({ brands: new Set(['ELEGOO']) })).toEqual(['3'])
    expect(ids({ finishes: new Set(['Silk' as const]) })).toEqual(['4'])
  })
  it('"só os que cobrem" usa a necessidade em gramas', () => {
    const low = [fil('a', 'X', 'PLA', 'Preto', '#111111', 100), fil('b', 'X', 'PLA', 'Preto', '#111111', 900)].map(toPickerItem)
    const f = { ...base, onlyCovering: true, need: 300 }
    expect(low.filter((i) => matchesFilters(i, f)).map((i) => i.id)).toEqual(['b'])
  })
})

describe('groupByFamily', () => {
  it('agrupa na ordem das famílias e ordena por cor', () => {
    const items = [fil('1', 'A', 'PLA', 'Branco', '#fafafa'), fil('2', 'A', 'PLA', 'Preto', '#111111')].map(toPickerItem)
    expect(groupByFamily(items).map((g) => g.family)).toEqual(['Pretos', 'Brancos'])
  })
})

describe('stockLevel', () => {
  it('vermelho quando não cobre, amarelo abaixo de 150 g', () => {
    expect(stockLevel(748, 925)).toBe('bad')
    expect(stockLevel(100, 0)).toBe('low')
    expect(stockLevel(900, 100)).toBe('ok')
  })
})

describe('defaultMaterial', () => {
  const items = [fil('1', 'A', 'PETG', 'Azul', '#1f5fe0'), fil('2', 'A', 'PLA', 'Preto', '#111111'), fil('3', 'A', 'PETG', 'Rosa', '#ff4f9a')].map(toPickerItem)
  it('usa o tipo do selecionado, depois o das outras cores, senão all', () => {
    expect(defaultMaterial(items, '2', [])).toBe('PLA')
    expect(defaultMaterial(items, null, ['1', '3'])).toBe('PETG')
    expect(defaultMaterial(items, null, [])).toBe('all')
  })
})
