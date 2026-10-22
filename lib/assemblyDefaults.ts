import type { AssemblyStatus, AssemblyPartColorOption } from '@/actions/assembly'

// Padrões da montagem em 1 clique: espelha EXATAMENTE o que o formulário
// (ConfirmAssemblyForm) pré-seleciona -- a combinação que o pedido pediu
// (quando existe e é válida), senão a cor registrada do acessório, senão a
// de maior estoque -- e calcula o máximo de unidades com essas escolhas.

interface Selectable {
  key: string
  quantityPerUnit: number
  colorOptions: AssemblyPartColorOption[] | null
  maxUnits: number
  blocks: boolean // peça/componente bloqueiam; acessório com cor nunca
}

function defaultChoice(s: Selectable, preset: Record<string, string> | null): string {
  if (!s.colorOptions || s.colorOptions.length === 0) return ''
  const wanted = preset?.[s.key]
  if (wanted && s.colorOptions.some((o) => o.key === wanted)) return wanted
  // Acessório: o registrado na ficha (key = id do próprio acessório) tem
  // prioridade se houver estoque.
  const registered = s.colorOptions.find((o) => o.key === s.key)
  if (registered && registered.available > 0) return registered.key
  return s.colorOptions.reduce((a, b) => (b.available > a.available ? b : a)).key
}

export interface AssemblyPlan {
  colorChoices: Record<string, string>
  accessoryUsages: { id: string; quantityPerUnit: number }[]
  supplyUsages: { id: string; quantityPerUnit: number }[]
  maxUnits: number
  // Peças/componentes que limitam a quantidade, pra mensagem de "falta X".
  limiting: string[]
}

export function planDefaultAssembly(status: AssemblyStatus, preset: Record<string, string> | null): AssemblyPlan {
  const blocking: (Selectable & { name: string })[] = [
    ...status.parts.map((p) => ({ key: p.partId, name: p.name, quantityPerUnit: p.quantityPerUnit, colorOptions: p.colorOptions, maxUnits: p.maxUnitsFromThisPart, blocks: true })),
    ...status.components.map((c) => ({ key: c.componentProductId, name: c.name, quantityPerUnit: c.quantityPerUnit, colorOptions: c.colorOptions, maxUnits: c.maxUnitsFromThisComponent, blocks: true })),
  ]
  const accessoriesWithColor = status.accessoryRequirements.filter((a) => a.colorOptions)

  const colorChoices: Record<string, string> = {}
  for (const s of [...blocking, ...accessoriesWithColor.map((a) => ({ key: a.id, quantityPerUnit: a.quantityPerUnit, colorOptions: a.colorOptions, maxUnits: 0, blocks: false }))]) {
    if (s.colorOptions && s.colorOptions.length > 0) colorChoices[s.key] = defaultChoice(s, preset)
  }

  const perItem = blocking.map((s) => {
    if (!s.colorOptions || s.colorOptions.length === 0) return { name: s.name, units: s.maxUnits }
    const chosen = s.colorOptions.find((o) => o.key === colorChoices[s.key])
    return { name: s.name, units: chosen && s.quantityPerUnit > 0 ? Math.floor(chosen.available / s.quantityPerUnit) : 0 }
  })
  const maxUnits = perItem.length === 0 ? 0 : Math.max(0, Math.min(...perItem.map((p) => p.units)))

  return {
    colorChoices,
    accessoryUsages: [
      ...status.accessoryRequirements.filter((a) => !a.colorOptions).map((a) => ({ id: a.id, quantityPerUnit: a.quantityPerUnit })),
      ...accessoriesWithColor.map((a) => ({ id: colorChoices[a.id], quantityPerUnit: a.quantityPerUnit })),
    ],
    supplyUsages: status.supplyRequirements.map((s) => ({ id: s.id, quantityPerUnit: s.quantityPerUnit })),
    maxUnits,
    limiting: perItem.filter((p) => p.units <= 0 || p.units === maxUnits).map((p) => p.name),
  }
}
