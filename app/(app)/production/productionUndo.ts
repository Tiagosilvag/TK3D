import type { ProductionRunEditData, ProductionRunEditInput } from '@/actions/productionRuns'

// "Desfazer" depois de editar: a edição acontece numa tela e o aviso aparece
// na lista, então o estado anterior viaja pelo sessionStorage (só no cliente,
// some ao fechar a aba -- melhor que perder o Desfazer na navegação).
const KEY = 'tk3d:production-undo'

// 'edit': volta ao estado anterior da MESMA produção. 'restore': recria uma
// produção que acabou de ser excluída.
export type ProductionUndo =
  | { kind?: 'edit'; runId: string; previous: ProductionRunEditInput; message: string }
  | { kind: 'restore'; data: ProductionRunEditData; message: string }

export function stashProductionUndo(undo: ProductionUndo): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(undo))
  } catch {
    // sem sessionStorage: a edição vale, só não há "Desfazer".
  }
}

export function takeProductionUndo(): ProductionUndo | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(KEY)
    return JSON.parse(raw) as ProductionUndo
  } catch {
    return null
  }
}
