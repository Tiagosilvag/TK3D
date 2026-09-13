'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { VariantAttr, VariantAttrTier } from '@/lib/reports'
import { isOutsideDialogClick } from '@/lib/dialog'
import type { StockRow } from './StockExplorer'
import { EditVariantColorsForm } from './EditVariantColorsForm'

// Melhoria "Modal de variações -- chips por hierarquia": cada atributo da
// variante (Base, Tampa, Cor = peça do próprio produto; Mosquetão =
// componente; Corrente = acessório) vira um chip com peso visual diferente
// conforme `attr.tier` (ver VariantAttrTier em lib/reports.ts) -- produto
// tem destaque forte (fundo tingido na própria cor, valor em negrito),
// complemento é neutro (cinza, um degrau abaixo), acessório é o mais
// discreto (quase apagado). `attrs` já chega reordenado por hierarquia
// (Produto → Complemento → Acessório) de getProductVariantBreakdown --
// nunca reordena aqui de novo.
function ChipDots({ hexes, size }: { hexes: string[]; size: string }) {
  const [first, second] = hexes
  return (
    <span className="flex shrink-0">
      <span
        className={`inline-block rounded-full border border-black/10 dark:border-white/10 ${size}`}
        style={{ background: first ?? '#9CA3AF' }}
      />
      {second && (
        <span
          className={`-ml-1 inline-block rounded-full border border-black/10 dark:border-white/10 ${size}`}
          style={{ background: second }}
        />
      )}
    </span>
  )
}

const TIER_WRAP_CLASS: Record<VariantAttrTier, string> = {
  produto: 'border px-2.5 py-1',
  complemento: 'border border-slate-200 bg-slate-100 px-2.5 py-1 dark:border-slate-600 dark:bg-slate-700/50',
  acessorio: 'border border-slate-100 bg-slate-50 px-2 py-0.5 dark:border-slate-700/60 dark:bg-slate-800/40',
}
const TIER_NAME_CLASS: Record<VariantAttrTier, string> = {
  produto: 'text-[11px] text-slate-500 dark:text-slate-300',
  complemento: 'text-[10.5px] text-slate-500 dark:text-slate-400',
  acessorio: 'text-[10px] text-slate-400 dark:text-slate-500',
}
const TIER_VALUE_CLASS: Record<VariantAttrTier, string> = {
  produto: 'text-[13px] font-bold text-slate-900 dark:text-white',
  complemento: 'text-[12px] font-semibold text-slate-700 dark:text-slate-200',
  acessorio: 'text-[11px] text-slate-500 dark:text-slate-400',
}
const TIER_DOT_SIZE: Record<VariantAttrTier, string> = {
  produto: 'h-2.5 w-2.5',
  complemento: 'h-2 w-2',
  acessorio: 'h-1.5 w-1.5',
}

function VariantChip({ attr }: { attr: VariantAttr }) {
  // Produto: fundo/borda tingidos na própria cor do chip (a peça É o
  // produto) -- únicos que precisam de estilo inline, já que a cor é
  // dinâmica; complemento/acessório usam classes neutras fixas.
  const tintStyle = attr.tier === 'produto' && attr.colorHexes[0]
    ? { background: `${attr.colorHexes[0]}26`, borderColor: `${attr.colorHexes[0]}55` }
    : undefined
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${TIER_WRAP_CLASS[attr.tier]}`} style={tintStyle}>
      <ChipDots hexes={attr.colorHexes} size={TIER_DOT_SIZE[attr.tier]} />
      {attr.name && <span className={TIER_NAME_CLASS[attr.tier]}>{attr.name}</span>}
      {attr.value && <span className={TIER_VALUE_CLASS[attr.tier]}>{attr.value}</span>}
    </span>
  )
}

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
                {product.variants.length} variaç{product.variants.length === 1 ? 'ão' : 'ões'}
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
                  <th className="py-2">Variação</th>
                  <th className="py-2 text-right">Disponível</th>
                  <th className="py-2 text-right">Prontas p/ montar</th>
                  <th className="py-2 text-right">Consignado</th>
                  <th className="py-2 text-right">Vendido</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {product.variants.map((v) => (
                  <Fragment key={v.key}>
                    <tr className="tk-row">
                      <td className="py-2">
                        {v.attrs.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {v.attrs.map((attr, i) => <VariantChip key={i} attr={attr} />)}
                          </div>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            {v.colorHex && <span style={{ background: v.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                            {v.label}
                          </span>
                        )}
                      </td>
                      <td className={`text-right font-medium tabular-nums ${v.available > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                        {v.available}
                      </td>
                      <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{v.readyToAssemble ?? '—'}</td>
                      <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{v.consignado}</td>
                      <td className="text-right tabular-nums text-slate-500 dark:text-slate-400">{v.sold}</td>
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
                        <td colSpan={6} className="px-2">
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
