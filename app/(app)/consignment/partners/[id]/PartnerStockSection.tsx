'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import type { ConsignmentProductBreakdown } from '@/lib/reports'

// Melhoria "Parceiros de consignação" §5: uma linha por PRODUTO (totais
// somados de todas as cores) -- clicar abre um modal com um bloco por cor,
// cada um com Entregue/Vendido/Com ela daquela cor específica e os chips de
// acessório que ela usa (link externo pra abrir o acessório na tela de
// Acessórios). Produto sem nenhuma cor conhecida (variants = [{key: null}])
// não ganha "(N cores)" nem chips -- só os totais, sem detalhe extra.
export function PartnerStockSection({ products }: { products: ConsignmentProductBreakdown[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<ConsignmentProductBreakdown | null>(null)

  function openDetail(product: ConsignmentProductBreakdown) {
    setSelected(product)
    dialogRef.current?.showModal()
  }

  if (products.length === 0) {
    return (
      <div className="tk-panel p-4">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Estoque com o parceiro</h2>
        <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Nenhuma entrega registrada ainda.</p>
      </div>
    )
  }

  return (
    <div className="tk-panel p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Estoque com o parceiro</h2>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Clique em um produto pra ver o detalhe por cor.</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Produto</th>
            <th>Entregue</th>
            <th>Vendido</th>
            <th>Com ela</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const colorCount = p.variants.filter((v) => v.key).length
            return (
              <tr key={p.productId} onClick={() => openDetail(p)} className="tk-row cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <td className="py-2 font-medium text-slate-900 dark:text-slate-100">
                  {p.productName}
                  {colorCount > 1 && <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">({colorCount} cores)</span>}
                </td>
                <td>{p.delivered}</td>
                <td>{p.sold}</td>
                <td>{p.remaining}</td>
                <td className="text-right text-slate-400" aria-hidden>›</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        {selected && (
          <div className="grid gap-3 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">{selected.productName}</h3>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {selected.variants.map((v) => (
                <div key={v.key ?? '__none__'} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                      {v.colorHex && <span style={{ background: v.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                      {v.label ?? 'Sem cor registrada'}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Entregue {v.delivered} · Vendido {v.sold} · Com ela {v.remaining}
                    </span>
                  </div>
                  {v.accessories.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {v.accessories.map((a) => (
                        <Link
                          key={a.id}
                          href={`/accessories?editId=${a.id}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-amber-400 hover:text-amber-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-amber-500 dark:hover:text-amber-400"
                        >
                          {a.colorHex && <span style={{ background: a.colorHex }} className="inline-block h-2 w-2 shrink-0 rounded-full" />}
                          {a.name}{a.colorName && ` - ${a.colorName}`}
                          <span aria-hidden>↗</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-1 flex justify-end">
              <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
                Fechar
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  )
}
