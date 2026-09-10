// Ajuste "produção → montagem → estoque": um produto precisa passar por
// Montagem antes de virar estoque de produto acabado quando é composto
// (várias peças) OU quando tem qualquer insumo/acessório cadastrado na
// ficha técnica -- só a exceção "peça única, sem nenhum componente" vai
// direto de Produção pro estoque. Usado por actions/productionRuns.ts
// (decide se insumo/acessório são decrementados na hora ou só na
// montagem), actions/assembly.ts (decide quais produtos aparecem em
// /assembly) e lib/reports.ts#getOwnStockSummary (decide se "produzido"
// vem de ProductionRun direto ou de ProductAssembly).
//
// Vive fora de actions/*.ts de propósito: um arquivo com 'use server' só
// pode exportar funções async (viram Server Actions), e esta é uma função
// pura síncrona.
export function productNeedsAssembly(product: { isComposite: boolean; accessoryUsagesCount: number; supplyUsagesCount: number }): boolean {
  return product.isComposite || product.accessoryUsagesCount > 0 || product.supplyUsagesCount > 0
}
