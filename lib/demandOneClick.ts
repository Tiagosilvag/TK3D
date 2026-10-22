import type { ProductProductionDefaults } from '@/actions/products'

// Lógica pura do "✓ Produzido" em 1 clique (painel "Peças pendentes de
// encomenda"): monta o item de produção a partir da ficha técnica + pedido,
// confere o consumo por rolo e agrupa as linhas por item de pedido.

export interface OneClickInput {
  productId: string
  partId: string | null
  // Cor que o pedido exige (peça de cor variável, 1 componente); null = a da ficha.
  filamentIds: string[] | null
  quantity: number
}

export interface OneClickItem {
  productId: string
  productPartId: string | null
  printerId: string
  date: string
  quantityPlanned: number
  quantitySuccess: number
  filaments: { filamentId: string; weightGramsPerUnit: number; gramsWasted: number }[]
  timeWastedHours: number
  wasteReason: null
  notes: null
}

export function buildOneClickItem(
  input: OneClickInput,
  defaults: ProductProductionDefaults,
  date: string,
): OneClickItem | { error: string } {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return { error: 'Quantidade inválida.' }

  let printerId: string | null | undefined
  let components: { filamentId: string; weightGrams: number }[]

  if (input.partId) {
    const part = defaults.parts?.find((p) => p.id === input.partId)
    if (!part) return { error: 'Peça não encontrada na ficha técnica.' }
    printerId = part.printerId
    const useRequestedColor = part.filaments.length === 1 && input.filamentIds?.length === 1
    components = part.filaments.map((f) => ({ filamentId: useRequestedColor ? input.filamentIds![0] : f.filamentId, weightGrams: f.weightGrams }))
  } else {
    printerId = defaults.printerId
    components = defaults.filamentId
      ? [{ filamentId: input.filamentIds?.[0] ?? defaults.filamentId, weightGrams: defaults.weightGrams ?? 0 }]
      : []
  }

  if (!printerId) return { error: 'A ficha técnica não tem impressora.' }
  if (components.length === 0 || components.some((c) => !c.filamentId)) return { error: 'A ficha técnica não tem filamento.' }

  return {
    productId: input.productId,
    productPartId: input.partId,
    printerId,
    date,
    quantityPlanned: input.quantity,
    quantitySuccess: input.quantity,
    filaments: components.map((c) => ({ filamentId: c.filamentId, weightGramsPerUnit: c.weightGrams, gramsWasted: 0 })),
    timeWastedHours: 0,
    wasteReason: null,
    notes: null,
  }
}

export interface RollShortfall {
  filamentId: string
  needed: number
  available: number
}

// Consumo por ROLO somando todas as peças juntas -- duas peças que usam o
// mesmo filamento disputam o mesmo estoque, então cada uma isolada "cabe"
// e as duas juntas podem não caber.
export function rollShortfalls(items: Pick<OneClickItem, 'quantityPlanned' | 'filaments'>[], stockByFilamentId: ReadonlyMap<string, number>): RollShortfall[] {
  const needed = new Map<string, number>()
  for (const item of items) {
    for (const f of item.filaments) {
      needed.set(f.filamentId, (needed.get(f.filamentId) ?? 0) + f.weightGramsPerUnit * item.quantityPlanned + f.gramsWasted)
    }
  }
  const result: RollShortfall[] = []
  for (const [filamentId, total] of needed) {
    const available = stockByFilamentId.get(filamentId) ?? 0
    if (total > available + 1e-9) result.push({ filamentId, needed: total, available })
  }
  return result
}

export function groupByOrderItem<T extends { orderItemId: string }>(rows: T[]): { orderItemId: string; rows: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const list = groups.get(row.orderItemId) ?? []
    list.push(row)
    groups.set(row.orderItemId, list)
  }
  return [...groups.entries()].map(([orderItemId, list]) => ({ orderItemId, rows: list }))
}

export interface RollUsage {
  used: number
  available: number
}

// Consumo total por rolo somando TODAS as linhas ativas do formulário (quem
// divide o mesmo rolo disputa o mesmo estoque) -- base do aviso "Usa X g ·
// sobram Y g" em cada linha de filamento.
export function rollTotals(
  items: { quantityPlanned: number; filaments: { filamentId: string; weightGramsPerUnit: number; gramsWasted: number }[] }[],
  stockByFilamentId: ReadonlyMap<string, number>,
): Map<string, RollUsage> {
  const used = new Map<string, number>()
  for (const item of items) {
    for (const f of item.filaments) {
      if (!f.filamentId) continue
      used.set(f.filamentId, (used.get(f.filamentId) ?? 0) + f.weightGramsPerUnit * item.quantityPlanned + f.gramsWasted)
    }
  }
  const result = new Map<string, RollUsage>()
  for (const [filamentId, total] of used) result.set(filamentId, { used: total, available: stockByFilamentId.get(filamentId) ?? 0 })
  return result
}
