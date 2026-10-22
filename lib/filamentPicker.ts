// Lógica pura do seletor de filamento (components/FilamentPicker.tsx) --
// separada do componente pra ser testável sem DOM: família de cor,
// acabamento, busca/filtros e agrupamento.

export interface PickerFilament {
  id: string
  manufacturer: string
  material: string // PLA | PETG | TPU | OUTRO
  colorName: string
  colorHex: string | null
  stockGrams: number
}

export type Finish = 'Comum' | 'Matte' | 'Silk' | 'Translúcido'
export const FINISHES: Finish[] = ['Comum', 'Matte', 'Silk', 'Translúcido']

// Ordem de exibição dos grupos. "Cinzas e pratas" cobre o que não é nem
// preto nem branco de verdade (cinza, prata, grafite claro).
export const COLOR_FAMILIES = [
  'Pretos',
  'Brancos',
  'Cinzas e pratas',
  'Vermelhos e rosas',
  'Amarelos e dourados',
  'Verdes',
  'Azuis',
  'Roxos',
  'Marrons e tons de pele',
  'Outros',
] as const
export type ColorFamily = (typeof COLOR_FAMILIES)[number]

export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// O cadastro não tem campo de acabamento: ele vem escrito no nome da cor
// ("Branco Matte", "Dourado Silk", "Vermelho Translúcido"). Separa a cor
// pura do acabamento pra mostrar cada um no seu lugar.
export function splitColorName(colorName: string): { color: string; finish: Finish } {
  const patterns: [RegExp, Finish][] = [
    [/\b(matte|fosco)\b/i, 'Matte'],
    [/\b(silk|seda)\b/i, 'Silk'],
    [/\b(transl[uú]cid[oa]|transparente)\b/i, 'Translúcido'],
  ]
  for (const [re, finish] of patterns) {
    if (re.test(colorName)) {
      const color = colorName.replace(re, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–/]+|[\s\-–/]+$/g, '')
      return { color: color || colorName, finish }
    }
  }
  return { color: colorName.trim(), finish: 'Comum' }
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return { h, s, l }
}

// A família vem do hex cadastrado (nunca de um campo manual a manter).
export function colorFamily(hex: string | null): ColorFamily {
  const hsl = hex ? hexToHsl(hex) : null
  if (!hsl) return 'Outros'
  const { h, s, l } = hsl
  if (l < 0.16) return 'Pretos'
  if (s < 0.14) {
    if (l < 0.3) return 'Pretos'
    if (l > 0.82) return 'Brancos'
    return 'Cinzas e pratas'
  }
  if (l > 0.92) return 'Brancos'
  if (h >= 300 || h < 12) return 'Vermelhos e rosas'
  if (h < 50) {
    if (l < 0.42) return 'Marrons e tons de pele'
    if (s >= 0.75 && l < 0.72) return 'Amarelos e dourados'
    return 'Marrons e tons de pele'
  }
  if (h < 70) return 'Amarelos e dourados'
  if (h < 170) return 'Verdes'
  if (h < 260) return 'Azuis'
  return 'Roxos'
}

export interface PickerItem extends PickerFilament {
  color: string
  finish: Finish
  family: ColorFamily
}

export function toPickerItem(f: PickerFilament): PickerItem {
  const { color, finish } = splitColorName(f.colorName)
  return { ...f, color, finish, family: colorFamily(f.colorHex) }
}

export interface PickerFilters {
  material: string // 'all' ou PLA/PETG/...
  brands: ReadonlySet<string>
  finishes: ReadonlySet<Finish>
  query: string
  onlyCovering: boolean
  need: number
}

export function matchesFilters(item: PickerItem, f: PickerFilters, ignoreMaterial = false): boolean {
  if (!ignoreMaterial && f.material !== 'all' && item.material !== f.material) return false
  if (f.brands.size > 0 && !f.brands.has(item.manufacturer)) return false
  if (f.finishes.size > 0 && !f.finishes.has(item.finish)) return false
  if (f.onlyCovering && f.need > 0 && item.stockGrams < f.need) return false
  const terms = normalizeText(f.query).split(/\s+/).filter(Boolean)
  if (terms.length > 0) {
    const hay = normalizeText(`${item.manufacturer} ${item.color} ${item.finish === 'Comum' ? '' : item.finish} ${item.material}`)
    // Termo casa no início de uma palavra (ou na palavra inteira) --
    // "rosa" acha "Rosa pink", mas não "Vermelho"; "pret" acha "Preto".
    const words = hay.split(/[^a-z0-9]+/).filter(Boolean)
    if (!terms.every((t) => words.some((w) => w.startsWith(t)))) return false
  }
  return true
}

export function groupByFamily(items: PickerItem[]): { family: ColorFamily; items: PickerItem[] }[] {
  return COLOR_FAMILIES.map((family) => ({
    family,
    items: items
      .filter((i) => i.family === family)
      .sort((a, b) => a.color.localeCompare(b.color, 'pt-BR') || a.manufacturer.localeCompare(b.manufacturer, 'pt-BR')),
  })).filter((g) => g.items.length > 0)
}

export type StockLevel = 'ok' | 'low' | 'bad'
export const LOW_STOCK_GRAMS = 150
export function stockLevel(stockGrams: number, need: number): StockLevel {
  if (need > 0 && stockGrams < need) return 'bad'
  if (stockGrams < LOW_STOCK_GRAMS) return 'low'
  return 'ok'
}

// Material padrão do seletor: o do filamento já escolhido; sem ele, o mais
// comum entre as outras cores da mesma peça; sem nenhum, mostra tudo.
export function defaultMaterial(items: PickerItem[], selectedId: string | null, contextIds: readonly string[]): string {
  const selected = items.find((i) => i.id === selectedId)
  if (selected) return selected.material
  const counts = new Map<string, number>()
  for (const id of contextIds) {
    const m = items.find((i) => i.id === id)?.material
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? top[0] : 'all'
}

// Opção do <FilamentSelect> a partir de um registro Filament (Prisma) --
// um único construtor pra toda página que alimenta o seletor, assim
// nenhuma tela monta sua própria lista.
export function toFilamentSelectOption(
  f: {
    id: string
    manufacturer: string
    material: string
    colorName: string
    colorHex: string
    currentStockGrams: { toNumber(): number }
  },
  nameSuffix = '',
): { id: string; name: string; colorHex: string; manufacturer: string; material: string; colorName: string; stockGrams: number } {
  return {
    id: f.id,
    name: `${f.manufacturer} ${f.colorName} (${f.material})${nameSuffix}`,
    colorHex: f.colorHex,
    manufacturer: f.manufacturer,
    material: f.material,
    colorName: f.colorName,
    stockGrams: f.currentStockGrams.toNumber(),
  }
}
