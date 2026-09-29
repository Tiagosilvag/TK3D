'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ConsignmentProductBreakdown, ConsignmentSaleableDelivery } from '@/lib/reports'
import { deleteConsignmentDelivery, returnConsignmentDeliveryStock, undoConsignmentDeliveryReturn } from '@/actions/consignmentDeliveries'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { RegisterSaleForm } from './RegisterSaleForm'

// Melhoria "Parceiros de consignação" §5: uma linha por PRODUTO (totais
// somados de todas as cores) -- clicar abre um modal com um bloco por cor,
// cada um com Entregue/Vendido/Com ela daquela cor específica e os chips de
// acessório que ela usa (link externo pra abrir o acessório na tela de
// Acessórios). Produto sem nenhuma cor conhecida (variants = [{key: null}])
// não ganha "(N cores)" nem chips -- só os totais, sem detalhe extra.
export function PartnerStockSection({
  products,
  saleableDeliveries,
  defaultCommissionPercent,
}: {
  products: ConsignmentProductBreakdown[]
  saleableDeliveries: ConsignmentSaleableDelivery[]
  defaultCommissionPercent: number
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<ConsignmentProductBreakdown | null>(null)
  // Pedido "opção de devolver apenas 1 ou tudo": o campo de quantidade é
  // não-controlado (defaultValue), então o botão "(tudo)" precisa de uma
  // referência direta ao <input> daquela entrega pra escrever nele -- um Map
  // por deliveryId em vez de 1 ref por linha, já que a lista é dinâmica.
  const quantityInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  function openDetail(product: ConsignmentProductBreakdown) {
    setSelected(product)
    dialogRef.current?.showModal()
  }

  // Melhoria "editar tudo no consignado": devolver peças ao próprio estoque
  // e remover entrega agem na entrega específica (id), não no agregado por
  // produto/cor -- depois de um sucesso, refresh() traz o `selected` já
  // recalculado (mesma re-sincronização que DeliveriesExplorer já faz).
  async function handleReturnStock(deliveryId: string, formData: FormData) {
    const result = await returnConsignmentDeliveryStock(deliveryId, formData)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.refresh()
  }

  async function handleRemoveDelivery(deliveryId: string) {
    const result = await deleteConsignmentDelivery(deliveryId)
    if (result.success) router.refresh()
    return result
  }

  // Pedido "quero a opção de desfazer também uma devolução, se marcou
  // errado -- mas somente qnd ele fica devolvido": zera returnedQuantity,
  // trazendo a entrega de volta ao estado normal (com o parceiro de novo).
  // Sem confirmação (ação reversível, ao contrário de Remover) -- mesma
  // ausência de confirm() que "Devolver" já tinha.
  async function handleUndoReturn(deliveryId: string) {
    const result = await undoConsignmentDeliveryReturn(deliveryId)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.refresh()
  }

  // Bug fix (mesmo de DeliveriesExplorer): `selected` é um snapshot tirado
  // em openDetail(). router.refresh() atualiza a prop `products`, mas
  // `selected` nunca era re-sincronizado sozinho -- devolução/remoção
  // pareciam não ter feito nada até fechar e reabrir a modal.
  useEffect(() => {
    setSelected((prev) => (prev ? (products.find((p) => p.productId === prev.productId) ?? null) : prev))
  }, [products])

  useEffect(() => {
    if (selected === null && dialogRef.current?.open) dialogRef.current.close()
  }, [selected])

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
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Estoque com o parceiro</h2>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Clique em um produto pra ver o detalhe por cor.</p>
        </div>
        <RegisterSaleForm deliveries={saleableDeliveries} defaultCommissionPercent={defaultCommissionPercent} />
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="tk-table-head-row">
            <th className="py-2">Produto</th>
            <th className="text-center">Entregue</th>
            <th className="text-center">Vendido</th>
            <th className="text-center">Com ela</th>
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
                <td className="text-center">{p.delivered}</td>
                <td className="text-center">{p.sold}</td>
                <td className="text-center">{p.remaining}</td>
                <td className="text-right text-slate-400" aria-hidden>›</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        className="w-full [--tk-dialog-cap:32rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        {selected && (
          <div className="grid grid-cols-1 gap-3 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">{selected.productName}</h3>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {/* Bug "variações zeradas ainda aparecem": uma cor cujo total
                  entregue chegou a 0 sem passar pelo novo returnedQuantity
                  (entrega devolvida pela lógica ANTIGA, anterior a este
                  campo -- quantityDelivered já foi sobrescrito pra 0 no
                  banco, sem meio de saber que "foi devolvida") não tem mais
                  nada útil pra mostrar aqui: nenhuma entrega dela passa no
                  isReturned (returnedQuantity fica 0 pra sempre nesses
                  casos legados) nem sobra saldo pra devolver, só um bloco
                  vazio 0/0/0. Uma cor devolvida pelo fluxo NOVO nunca cai
                  aqui -- quantityDelivered continua > 0 (nunca reescrito),
                  só returnedQuantity sobe, então v.delivered permanece o
                  valor histórico real. */}
              {selected.variants.filter((v) => v.delivered > 0).map((v) => (
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

                  {/* Melhoria "editar tudo no consignado" (revisão "a mesma lógica de
                      produção"): ação por ENTREGA específica (não dá pra devolver/
                      remover o agregado por cor -- ele pode vir de vários lotes com
                      datas diferentes). Uma entrega cujo saldo chegou a 0 POR DEVOLUÇÃO
                      (não por ter sido tudo vendido) vira "Devolvida" -- mesmo
                      tratamento de uma ProductionRun CANCELADA: continua visível com
                      os números originais (nunca reescritos), badge marca o estado,
                      "Desfazer" volta a ficar com o parceiro (zera returnedQuantity),
                      "Remover" apaga em definitivo (só aí some da tela). */}
                  <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                    {v.deliveries.map((d) => {
                      const isReturned = d.remaining === 0 && d.returnedQuantity > 0
                      return (
                        <div key={d.deliveryId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="flex flex-wrap items-center gap-1.5 text-slate-400 dark:text-slate-500">
                            {new Date(d.deliveryDate).toLocaleDateString('pt-BR')} · entregue {d.delivered}
                            {d.sold > 0 && ` · vendido ${d.sold}`}
                            {isReturned && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                Devolvida
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-2">
                            {isReturned && (
                              <button
                                type="button"
                                onClick={() => handleUndoReturn(d.deliveryId)}
                                className="font-medium text-violet-600 hover:underline dark:text-violet-400"
                              >
                                Desfazer
                              </button>
                            )}
                            {!isReturned && d.remaining > 0 && (
                              <form action={(fd) => handleReturnStock(d.deliveryId, fd)} className="flex items-center gap-1">
                                <input
                                  ref={(el) => {
                                    if (el) quantityInputRefs.current.set(d.deliveryId, el)
                                    else quantityInputRefs.current.delete(d.deliveryId)
                                  }}
                                  type="number"
                                  name="quantityReturned"
                                  step="1"
                                  min={1}
                                  max={d.remaining}
                                  // Pedido "se tem 2, quero a opção de devolver apenas 1 ou
                                  // tudo": default 1 (maioria das devoluções é unitária,
                                  // mesmo raciocínio do default de quantidade em Registrar
                                  // venda) -- "(tudo)" abaixo preenche o saldo inteiro com 1
                                  // clique quando for o caso.
                                  defaultValue={Math.min(1, d.remaining)}
                                  className="tk-input w-14 text-right"
                                />
                                <button type="submit" className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                                  Devolver
                                </button>
                                {d.remaining > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const input = quantityInputRefs.current.get(d.deliveryId)
                                      if (input) input.value = String(d.remaining)
                                    }}
                                    className="text-slate-400 hover:text-violet-600 dark:text-slate-500 dark:hover:text-violet-400"
                                  >
                                    (tudo)
                                  </button>
                                )}
                              </form>
                            )}
                            <ConfirmDeleteForm
                              action={() => handleRemoveDelivery(d.deliveryId)}
                              label="Remover"
                              className="font-medium text-red-600 hover:underline dark:text-red-400"
                              confirmMessage={
                                d.saleReportsCount > 0
                                  ? `Remover esta entrega? Isso também apaga ${d.saleReportsCount} relatório(s) de venda já registrado(s) contra ela.`
                                  : 'Remover esta entrega?'
                              }
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {v.accessories.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {v.accessories.map((a) => (
                        <Link
                          key={a.id}
                          href={`/accessories?editId=${a.id}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-violet-400 hover:text-violet-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-violet-500 dark:hover:text-violet-400"
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
