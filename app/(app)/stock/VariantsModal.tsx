'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { isOutsideDialogClick } from '@/lib/dialog'
import { ChipDots } from '@/components/VariantChip'
import type { StockRow, StockVariantRow } from './StockExplorer'
import { EditVariantColorsForm } from './EditVariantColorsForm'

// Melhoria "Modal de variações -- matriz por peça": produto composto virou
// uma tabela com 1 coluna fixa por peça (Base/Tampa/Mosquetão/Corrente...)
// em vez de chips em texto corrido que desalinhavam as colunas numéricas
// quando quebravam linha. Cada célula é só bolinha(s) de cor + nome --
// SEM o pill com fundo/borda de VariantChip (que continua existindo,
// intocado, só pra Vendas) -- aqui todas as peças têm o MESMO peso visual,
// mesmo a que hoje é tier "acessorio" (ex. Corrente): a distinção
// destaque/discreto só faz sentido no caso de peça única (ColorCell
// abaixo), onde o acessório é claramente secundário à cor principal.
function PieceCell({ variant, columnName }: { variant: StockVariantRow; columnName: string }) {
  const attr = variant.attrs.find((a) => a.name === columnName)
  if (!attr) return <span className="text-slate-300 dark:text-slate-600">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <ChipDots hexes={attr.colorHexes} size="h-2.5 w-2.5" />
      <span className="text-slate-700 dark:text-slate-200">{attr.value}</span>
    </span>
  )
}

// Peça única: 1 coluna "Cor" só -- bolinha grande + nome em negrito pra
// cor principal, acessório (tier "acessorio", se existir) vira etiqueta
// pequena/apagada ao lado ("Argola: Prata"), nunca do mesmo tamanho/peso
// da cor principal.
//
// A cor principal NÃO é sempre tier "produto": produto simples que
// precisa de montagem por ter acessório/insumo cadastrado (sem
// ProductPart nenhum -- "peça sintética", ver comentário "Bug 'cor no
// produto simples'" em lib/reports.ts#getProductVariantBreakdown) resolve
// pelo ramo de fallback de resolveChoiceAttr (nenhum ProductPart/Product-
// componente bate com a chave = o próprio productId, de propósito, pra
// não prefixar a cor com o nome do produto) -- que devolve tier
// "complemento", não "produto". Só produto simples SEM NENHUM componente
// (não passa por montagem) chega aqui com tier "produto" de verdade. Por
// isso a "cor principal" é definida como "o primeiro attr que não é
// acessório", nunca restrita a um tier específico.
function ColorCell({ variant }: { variant: StockVariantRow }) {
  if (variant.attrs.length === 0) {
    return (
      <span className="flex items-center gap-1.5">
        {variant.colorHex && <span style={{ background: variant.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
        {variant.label}
      </span>
    )
  }
  const main = variant.attrs.find((a) => a.tier !== 'acessorio')
  const accessories = variant.attrs.filter((a) => a.tier === 'acessorio')
  return (
    <span className="flex flex-wrap items-center gap-2">
      {main && (
        <span className="inline-flex items-center gap-2">
          <ChipDots hexes={main.colorHexes} size="h-3.5 w-3.5" />
          <span className="font-semibold text-slate-900 dark:text-white">{main.value}</span>
        </span>
      )}
      {accessories.map((a, i) => (
        <span key={i} className="text-xs text-slate-400 dark:text-slate-500">{a.name}: {a.value}</span>
      ))}
    </span>
  )
}

// Melhoria "Modal de variações -- cores nas colunas numéricas": Disponível
// tem 3 estados (zerado/baixo/normal, usando o mesmo critério de
// StockRow.lowStock -- Settings.productLowStockThreshold, ver
// StockVariantRow.lowStock em StockExplorer.tsx) -- sem ícone extra, só a
// cor do número.
function availableClass(v: StockVariantRow): string {
  if (v.available <= 0) return 'text-slate-400 dark:text-slate-500'
  if (v.lowStock) return 'font-medium text-amber-600 dark:text-amber-400'
  return 'font-medium text-emerald-600 dark:text-emerald-400'
}

// Prontas p/ montar, Consignado e Vendido: cor fixa própria quando > 0,
// cinza apagado e sem negrito quando 0 (ou null, "não aplicável") -- não
// competem visualmente com os números que importam.
function zeroableClass(value: number | null, colorClass: string): string {
  if (value === null || value === 0) return 'text-slate-300 dark:text-slate-600'
  return `font-medium ${colorClass}`
}

const NUMERIC_DIVIDER = 'border-l border-slate-200 dark:border-slate-700'

// Redesign "Estoque moderno" §10-12: modal nativa (<dialog>, mesmo padrão
// zero-lib de components/AdjustStockButton.tsx) pras variações de cor de um
// produto -- centralizada/responsiva via a regra global `dialog { margin:
// auto; max-width; max-height; overflow-y: auto }` (app/globals.css).
// Fecha pelo X, por fora (clique no próprio <dialog>, que É a área de
// backdrop quando aberto via showModal()) ou ESC (evento nativo `close`).
export function VariantsModal({ product, onClose }: { product: StockRow | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Pedido "não tem como corrigir a cor gravada errada": qual variante
  // (por `key`, o comboKey de ProductAssembly.colorChoices) está sendo
  // editada agora, se alguma -- inline na própria linha, nunca um
  // <dialog> aninhado dentro deste (mesmo cuidado já tomado em
  // ComponentCategoryCard, ver seu comentário sobre o bug de stacking).
  const [editingKey, setEditingKey] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (product) {
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [product])

  useEffect(() => {
    setEditingKey(null)
  }, [product])

  // Melhoria "Modal de variações -- matriz por peça": 1 coluna por nome de
  // peça distinto entre TODAS as variantes (união, não só a 1ª) -- ordem
  // de primeira aparição, que já vem tier-ordenada de `attrs`
  // (getProductVariantBreakdown), então sai Base/Tampa/Mosquetão/Corrente
  // na ordem certa sem precisar reordenar aqui.
  const pieceColumns = useMemo(() => {
    if (!product || !product.isComposite) return []
    return Array.from(new Set(product.variants.flatMap((v) => v.attrs.map((a) => a.name))))
  }, [product])
  const totalColumns = (product?.isComposite ? pieceColumns.length : 1) + 5

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => { if (isOutsideDialogClick(e)) onClose() }}
      className="w-full [--tk-dialog-cap:760px] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {product && (
        <div className="flex max-h-[75vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h3 className="font-display text-base font-semibold">Variações — {product.productName}</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {product.variants.length} variaç{product.variants.length === 1 ? 'ão' : 'ões'} · {product.category} · {product.isComposite ? 'Composto' : 'Peça única'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="tk-table-head-row sticky top-0 bg-white dark:bg-slate-900">
                  {product.isComposite
                    ? pieceColumns.map((name) => <th key={name} className="py-2">{name}</th>)
                    : <th className="py-2">Cor</th>}
                  <th className="py-2 text-right text-emerald-600 dark:text-emerald-400">Disponível</th>
                  <th className={`py-2 text-right text-blue-600 dark:text-blue-400 ${NUMERIC_DIVIDER}`}>Prontas p/ montar</th>
                  <th className={`py-2 text-right text-violet-600 dark:text-violet-400 ${NUMERIC_DIVIDER}`}>Consignado</th>
                  <th className={`py-2 text-right text-slate-500 dark:text-slate-400 ${NUMERIC_DIVIDER}`}>Vendido</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {product.variants.map((v) => (
                  <Fragment key={v.key}>
                    <tr className="tk-row">
                      {product.isComposite ? (
                        v.attrs.length === 0 ? (
                          <td className="py-2 text-slate-400 dark:text-slate-500" colSpan={pieceColumns.length}>{v.label}</td>
                        ) : (
                          pieceColumns.map((name) => (
                            <td key={name} className="py-2">
                              <PieceCell variant={v} columnName={name} />
                            </td>
                          ))
                        )
                      ) : (
                        <td className="py-2">
                          <ColorCell variant={v} />
                        </td>
                      )}
                      <td className={`text-right tabular-nums ${availableClass(v)}`}>{v.available}</td>
                      <td className={`text-right tabular-nums ${NUMERIC_DIVIDER} ${zeroableClass(v.readyToAssemble, 'text-blue-600 dark:text-blue-400')}`}>{v.readyToAssemble ?? '—'}</td>
                      <td className={`text-right tabular-nums ${NUMERIC_DIVIDER} ${zeroableClass(v.consignado, 'text-violet-600 dark:text-violet-400')}`}>{v.consignado}</td>
                      <td className={`text-right tabular-nums ${NUMERIC_DIVIDER} ${zeroableClass(v.sold, 'text-slate-500 dark:text-slate-400')}`}>{v.sold}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => setEditingKey(editingKey === v.key ? null : v.key)}
                          className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                    {editingKey === v.key && (
                      <tr className="bg-slate-50 dark:bg-slate-800/40">
                        <td colSpan={totalColumns} className="px-2">
                          <EditVariantColorsForm
                            productId={product.productId}
                            comboKey={v.key}
                            onCancel={() => setEditingKey(null)}
                            // Fecha a modal inteira (não só o formulário de edição):
                            // `product` vem do state `viewingProduct` do componente
                            // pai (capturado no clique de "Ver variações"), que
                            // router.refresh() sozinho não atualiza -- deixaria a
                            // modal aberta mostrando o rótulo de cor ANTIGO até o
                            // usuário fechar e reabrir. Fechar força reabrir com
                            // dado fresco na próxima vez.
                            onSaved={onClose}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
