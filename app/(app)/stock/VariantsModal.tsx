'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { StockRow } from './StockExplorer'
import { EditVariantColorsForm } from './EditVariantColorsForm'

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
      onClick={(e) => { if (e.target === dialogRef.current) onClose() }}
      className="w-full max-w-[760px] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
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
                        <span className="flex items-center gap-1.5">
                          {v.colorHex && <span style={{ background: v.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                          {v.label}
                        </span>
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
