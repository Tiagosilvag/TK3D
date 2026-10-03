// Ajuste "produção → montagem → estoque": um produto precisa passar por
// Montagem antes de virar estoque de produto acabado quando é composto
// (várias peças) OU quando tem qualquer insumo/acessório/componente-produto
// cadastrado na ficha técnica -- só a exceção "peça única, sem nenhum
// componente" vai direto de Produção pro estoque. Usado por
// actions/productionRuns.ts (decide se insumo/acessório são decrementados
// na hora ou só na montagem), actions/assembly.ts (decide quais produtos
// aparecem em /assembly) e lib/reports.ts#getOwnStockSummary (decide se
// "produzido" vem de ProductionRun direto ou de ProductAssembly).
//
// Melhoria "Produto-como-componente": componentUsagesCount conta
// ProductComponentUsage (outros produtos usados como ingrediente, ex.:
// Mosquetão dentro de Chaveiro Café) -- mesma regra de acessório/insumo,
// precisa de montagem antes de virar estoque de produto acabado.
//
// Vive fora de actions/*.ts de propósito: um arquivo com 'use server' só
// pode exportar funções async (viram Server Actions), e esta é uma função
// pura síncrona.
export function productNeedsAssembly(product: { isComposite: boolean; accessoryUsagesCount: number; supplyUsagesCount: number; componentUsagesCount: number }): boolean {
  return product.isComposite || product.accessoryUsagesCount > 0 || product.supplyUsagesCount > 0 || product.componentUsagesCount > 0
}

// Melhoria "Peça multi-filamento sem montagem": pedido do usuário -- uma
// peça que já sai PRONTA da impressora (ex.: cubo metade preto/metade
// colorido, impresso numa tacada só com 2 filamentos simultâneos) não
// devia exigir ir em /assembly clicar "Montar agora" só pra converter
// "peça produzida" em "estoque de produto acabado" -- hoje isso só é
// possível modelando como produto COMPOSTO com 1 única ProductPart
// multi-filamento (único jeito de ter >1 filamento por peça, ver
// ProductPart/ProductPartFilament no schema), o que automaticamente
// disparava productNeedsAssembly=true por causa de isComposite, mesmo não
// havendo NADA de fato pra montar (nenhuma segunda peça física pra
// encaixar, nenhum insumo/acessório pra colar).
//
// `productAutoAssembles` identifica exatamente esse caso degenerado:
// produto composto com UMA ÚNICA peça, proporção 1:1 (quantityPerUnit),
// sem insumo/acessório/componente-produto -- nada que justifique uma
// confirmação manual. actions/productionRuns.ts usa isto (não
// productNeedsAssembly, que continua true pra este caso -- a peça ainda
// precisa de /assembly existir como conceito, só que a confirmação
// acontece sozinha) pra chamar actions/assembly.ts#autoAssembleProductionRun
// automaticamente logo após a ProductionRun da peça ser criada, com a
// MESMA quantidade/cor que acabou de ser produzida -- o resto do app
// (Estoque, Pedidos, Montagem) nunca precisa saber que essa montagem foi
// automática: é um ProductAssembly de verdade, só que criado sem clique.
//
// Produto com 2+ peças (precisa combinar peças físicas distintas) ou com
// quantityPerUnit > 1 (precisa de N cópias da mesma peça por unidade) NÃO
// se qualifica -- esses casos são montagem de verdade, com decisão real a
// tomar (qual cor de cada peça, quantas unidades dá pra montar agora).
export function productAutoAssembles(product: {
  isComposite: boolean
  accessoryUsagesCount: number
  supplyUsagesCount: number
  componentUsagesCount: number
  parts: { quantityPerUnit: number }[]
}): boolean {
  if (!product.isComposite) return false
  if (product.accessoryUsagesCount > 0 || product.supplyUsagesCount > 0 || product.componentUsagesCount > 0) return false
  return product.parts.length === 1 && product.parts[0].quantityPerUnit === 1
}
