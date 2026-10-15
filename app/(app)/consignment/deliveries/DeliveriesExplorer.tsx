'use client'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import type { VariantAttr } from '@/lib/reports'
import {
  deleteConsignmentDeliveryBatch,
  updateConsignmentDeliveryBatchItems,
} from '@/actions/consignmentDeliveries'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { Stepper } from '@/components/Stepper'
import { VariacaoPecas } from '@/components/VariacaoPecas'
import { DeliveryBatchForm, type PartnerOption, type ProductOption } from './DeliveryBatchForm'

export interface DeliveryBatchItem {
  id: string
  productId: string
  colorComboKey: string | null
  productName: string
  colorLabel: string | null
  colorHex: string | null
  // Melhoria "Detalhe da entrega em consignação": peças em linhas curtas
  // (rótulo + bolinha + cor), mesmo componente VariacaoPecas usado em
  // Pedidos -- nunca mais o texto corrido único que `colorLabel` sozinho
  // produzia pra produto composto ("ARGOLA — PRATA, CORPO: ... + ...").
  attrs: VariantAttr[]
  quantityDelivered: number
  unitPrice: number
  // Bug "remover entrega já vendida deve ser possível + ajustar
  // quantidade": pra validar o mínimo do campo de quantidade (não dá pra
  // baixar pra menos do que já foi vendido) e pra avisar quantos
  // relatórios de venda somem junto se a entrega inteira for removida.
  quantitySold: number
  // Melhoria "Detalhe da entrega em consignação": piso da quantidade
  // também conta o que já voltou por devolução (returnConsignmentDeliveryStock
  // em PartnerStockSection.tsx) -- mesmo `floor` de
  // updateConsignmentDeliveryQuantity (actions/consignmentDeliveries.ts).
  returnedQuantity: number
  saleReportsCount: number
}

export interface DeliveryBatchRow {
  batchId: string
  partnerName: string
  deliveryDate: string
  // Melhoria "Detalhe da entrega em consignação": selo "✎ Editada hoje"
  // no cabeçalho do modal -- MAX(updatedAt) entre os itens do lote, só
  // quando algum deles de fato avançou (ver comentário de
  // ConsignmentDelivery.updatedAt no schema e de `editedAt` em page.tsx).
  editedAt: string | null
  items: DeliveryBatchItem[]
}

type ItemDraft = { quantity: number; unitPrice: number }

interface NewItemDraft {
  localId: string
  productId: string
  productName: string
  colorComboKey: string | null
  colorLabel: string | null
  colorHex: string | null
  quantity: number
  unitPrice: number
}

function floorFor(item: DeliveryBatchItem): number {
  return item.quantitySold + item.returnedQuantity
}

// Melhoria "Detalhe da entrega em consignação": lista de alterações do
// rascunho atual (nunca persistida -- só existe enquanto o modal está
// aberto), usada tanto pro contador/rodapé "N alterações ainda não
// salvas" quanto pro resumo "N alterações salvas" depois de gravar.
function computeChangeLines(
  batch: DeliveryBatchRow,
  drafts: Record<string, ItemDraft>,
  removedIds: Set<string>,
  newItems: NewItemDraft[],
): string[] {
  const lines: string[] = []
  for (const item of batch.items) {
    if (removedIds.has(item.id)) {
      lines.push(`Removeu ${item.productName}${item.colorLabel ? ` (${item.colorLabel})` : ''}`)
      continue
    }
    const draft = drafts[item.id]
    if (!draft) continue
    if (draft.quantity !== item.quantityDelivered) lines.push(`${item.productName}: quantidade ${item.quantityDelivered} → ${draft.quantity}`)
    if (draft.unitPrice !== item.unitPrice) lines.push(`${item.productName}: preço ${formatCurrency(item.unitPrice)} → ${formatCurrency(draft.unitPrice)}`)
  }
  for (const n of newItems) {
    lines.push(`Adicionou ${n.productName}${n.colorLabel ? ` (${n.colorLabel})` : ''} (${n.quantity}x)`)
  }
  return lines
}

// Pedido "+ Adicionar produto a esta entrega": form inline compacto (não
// o picker de 2 colunas do "Registrar entrega" -- aqui é só 1 produto de
// cada vez, acrescentado a um lote já existente). Variante default é a
// 1ª disponível (mesmo critério de "mais disponível primeiro" que
// ProductOption.variants já vem ordenado, ver DeliveryBatchForm.tsx).
function AddProductForm({ products, onAdd, onCancel }: { products: ProductOption[]; onAdd: (item: NewItemDraft) => void; onCancel: () => void }) {
  const [productId, setProductId] = useState(products[0]?.productId ?? '')
  const product = products.find((p) => p.productId === productId)
  const [variantKey, setVariantKey] = useState(product?.variants[0]?.key ?? '')
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState(product?.suggestedPrice ?? 0)

  function handleProductChange(id: string) {
    setProductId(id)
    const p = products.find((x) => x.productId === id)
    setVariantKey(p?.variants[0]?.key ?? '')
    setUnitPrice(p?.suggestedPrice ?? 0)
  }

  function confirm() {
    if (!product) return
    const variant = product.variants.find((v) => v.key === variantKey)
    onAdd({
      localId: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      productId: product.productId,
      productName: product.productName,
      colorComboKey: variant?.key ?? null,
      colorLabel: variant?.label ?? null,
      colorHex: variant?.colorHex ?? null,
      quantity,
      unitPrice,
    })
  }

  if (products.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">Nenhum produto em estoque disponível pra adicionar.</p>
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-2.5 dark:border-violet-800 dark:bg-violet-500/5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-500 dark:text-slate-400">
          Produto
          <select value={productId} onChange={(e) => handleProductChange(e.target.value)} className="tk-input-full mt-1">
            {products.map((p) => <option key={p.productId} value={p.productId}>{p.productName}</option>)}
          </select>
        </label>
        {product && product.variants.length > 0 && (
          <label className="text-xs text-slate-500 dark:text-slate-400">
            Cor
            <select value={variantKey} onChange={(e) => setVariantKey(e.target.value)} className="tk-input-full mt-1">
              {product.variants.map((v) => <option key={v.key} value={v.key}>{v.label} ({v.available} disp.)</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-4">
        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="mb-1 block">Quantidade</span>
          <Stepper value={quantity} min={1} step={1} onChange={setQuantity} />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="mb-1 block">Preço unitário</span>
          <Stepper value={unitPrice} min={0} step={1} onChange={setUnitPrice} />
        </label>
        <div className="ml-auto flex gap-3 text-xs">
          <button type="button" onClick={onCancel} className="text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
          <button type="button" onClick={confirm} className="font-medium text-violet-600 hover:underline dark:text-violet-400">Adicionar</button>
        </div>
      </div>
    </div>
  )
}

// Melhoria "Entregas em consignação" §4: lista principal vira uma linha por
// EVENTO de entrega (agrupado por batchId, ver ConsignmentDelivery.batchId
// no schema), não mais uma linha por produto -- clicar abre um modal com o
// detalhe de cada produto/cor daquela entrega específica.
export function DeliveriesExplorer({
  batches,
  partners,
  products,
  defaultProductId,
}: {
  batches: DeliveryBatchRow[]
  partners: PartnerOption[]
  products: ProductOption[]
  defaultProductId?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<DeliveryBatchRow | null>(null)
  const [newDeliveryOpen, setNewDeliveryOpen] = useState(!!defaultProductId)

  // Melhoria "Detalhe da entrega em consignação": modal inteiro vira um
  // RASCUNHO local (mesmo padrão de updateOrderDraft/OrderDetailDrawer.tsx
  // em Pedidos) -- quantidade/preço/remoção de item existente e produto
  // novo adicionado ao lote só são gravados juntos, no clique de "Salvar
  // alterações" (updateConsignmentDeliveryBatchItems), nunca 1 "Salvar"
  // por campo como antes.
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({})
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [newItems, setNewItems] = useState<NewItemDraft[]>([])
  const [addingProduct, setAddingProduct] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  function openDetail(batch: DeliveryBatchRow) {
    setSelected(batch)
    setDrafts(Object.fromEntries(batch.items.map((i) => [i.id, { quantity: i.quantityDelivered, unitPrice: i.unitPrice }])))
    setRemovedIds(new Set())
    setNewItems([])
    setAddingProduct(false)
    setError(null)
    setSavedMessage(null)
    dialogRef.current?.showModal()
  }

  // Bug fix: `selected` is a one-time snapshot taken in openDetail(). Removing
  // a line item calls router.refresh(), which updates the `batches` prop from
  // the server, but `selected` was never re-synced -- the just-deleted item
  // kept showing in the still-open modal until it was closed and reopened,
  // looking like the delete silently failed. Re-derive `selected` from the
  // fresh `batches` prop whenever it changes.
  useEffect(() => {
    setSelected((prev) => (prev ? (batches.find((b) => b.batchId === prev.batchId) ?? null) : prev))
  }, [batches])

  // If that re-sync empties out to null (the batch's last item was removed)
  // while the dialog is still open, close it too -- there is nothing left to
  // show, and leaving it open would strand an empty modal frame.
  useEffect(() => {
    if (selected === null && dialogRef.current?.open) dialogRef.current.close()
  }, [selected])

  const changeLines = useMemo(
    () => (selected ? computeChangeLines(selected, drafts, removedIds, newItems) : []),
    [selected, drafts, removedIds, newItems],
  )
  const hasChanges = changeLines.length > 0

  const activeItems = useMemo(() => (selected ? selected.items.filter((i) => !removedIds.has(i.id)) : []), [selected, removedIds])
  const draftValue = useMemo(
    () =>
      activeItems.reduce((sum, i) => sum + (drafts[i.id]?.quantity ?? i.quantityDelivered) * (drafts[i.id]?.unitPrice ?? i.unitPrice), 0)
      + newItems.reduce((sum, n) => sum + n.quantity * n.unitPrice, 0),
    [activeItems, drafts, newItems],
  )
  const draftPieces = useMemo(
    () => activeItems.reduce((sum, i) => sum + (drafts[i.id]?.quantity ?? i.quantityDelivered), 0) + newItems.reduce((sum, n) => sum + n.quantity, 0),
    [activeItems, drafts, newItems],
  )
  const draftProductsCount = activeItems.length + newItems.length
  const originalValue = useMemo(() => (selected ? selected.items.reduce((sum, i) => sum + i.quantityDelivered * i.unitPrice, 0) : 0), [selected])

  function updateDraft(id: string, patch: Partial<ItemDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function discard() {
    if (!selected) return
    setDrafts(Object.fromEntries(selected.items.map((i) => [i.id, { quantity: i.quantityDelivered, unitPrice: i.unitPrice }])))
    setRemovedIds(new Set())
    setNewItems([])
    setAddingProduct(false)
    setError(null)
  }

  function save() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const changes = selected.items
        .filter((i) => removedIds.has(i.id) || (drafts[i.id] && (drafts[i.id].quantity !== i.quantityDelivered || drafts[i.id].unitPrice !== i.unitPrice)))
        .map((i) => ({
          id: i.id,
          quantityDelivered: drafts[i.id]?.quantity ?? i.quantityDelivered,
          unitPrice: drafts[i.id]?.unitPrice ?? i.unitPrice,
          removed: removedIds.has(i.id),
        }))
      const fd = new FormData()
      fd.set('changesJson', JSON.stringify(changes))
      fd.set('newItemsJson', JSON.stringify(newItems.map((n) => ({
        productId: n.productId,
        colorComboKey: n.colorComboKey,
        quantityDelivered: n.quantity,
        unitPrice: n.unitPrice,
      }))))
      const changedCount = changeLines.length
      const result = await updateConsignmentDeliveryBatchItems(selected.batchId, fd)
      if (!result.success) return setError(result.error ?? 'Erro ao salvar alterações.')
      setSavedMessage(`${changedCount} ${changedCount === 1 ? 'alteração salva' : 'alterações salvas'}`)
      setRemovedIds(new Set())
      setNewItems([])
      router.refresh()
    })
  }

  async function handleDeleteBatch() {
    if (!selected) return { success: false, error: 'Nenhuma entrega selecionada' }
    const result = await deleteConsignmentDeliveryBatch(selected.batchId)
    if (result.success) {
      dialogRef.current?.close()
      router.refresh()
    }
    return result
  }

  return (
    <>
      <div className="flex justify-end">
        <button type="button" onClick={() => setNewDeliveryOpen(true)} className="tk-btn-primary px-4">
          + Registrar entrega
        </button>
      </div>

      {batches.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma entrega encontrada com esses filtros.
        </div>
      ) : (
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="tk-table-head-row">
              <th className="py-2">Data</th>
              <th>Parceiro</th>
              <th>Produtos</th>
              <th className="text-center">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => {
              const totalUnits = batch.items.reduce((sum, i) => sum + i.quantityDelivered, 0)
              const totalValue = batch.items.reduce((sum, i) => sum + i.quantityDelivered * i.unitPrice, 0)
              return (
                <tr key={batch.batchId} onClick={() => openDetail(batch)} className="tk-row cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="py-2">{new Date(batch.deliveryDate).toLocaleDateString('pt-BR')}</td>
                  <td className="font-medium text-slate-900 dark:text-slate-100">
                    {batch.partnerName}
                    {batch.editedAt && <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-400">✎</span>}
                  </td>
                  <td className="text-slate-500 dark:text-slate-400">{batch.items.length} {batch.items.length === 1 ? 'item' : 'itens'} - {totalUnits} un</td>
                  <td className="text-center font-medium text-slate-900 dark:text-slate-100">{formatCurrency(totalValue)}</td>
                  <td className="text-right text-slate-400" aria-hidden>›</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <DeliveryBatchForm
        open={newDeliveryOpen}
        onOpenChange={setNewDeliveryOpen}
        partners={partners}
        products={products}
        defaultProductId={defaultProductId}
      />

      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        className="w-full [--tk-dialog-cap:34rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:[--tk-dialog-cap:44rem]"
      >
        {selected && (
          <div className="grid grid-cols-1 gap-3 p-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Entrega em consignação</p>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-base font-semibold">{selected.partnerName} · {new Date(selected.deliveryDate).toLocaleDateString('pt-BR')}</h3>
                  {selected.editedAt && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                      ✎ Editada hoje
                    </span>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
            </div>

            {savedMessage && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                ✓ Entrega atualizada · {savedMessage}
              </div>
            )}
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{error}</div>}

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-slate-200 px-3 py-2 text-center dark:border-slate-700">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Peças</p>
                <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{draftPieces}</p>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2 text-center dark:border-slate-700">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Produtos</p>
                <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{draftProductsCount}</p>
              </div>
              <div className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-center dark:border-violet-700 dark:bg-violet-500/10">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">Valor da entrega</p>
                <p className="text-lg font-bold tabular-nums text-violet-700 dark:text-violet-300">{formatCurrency(draftValue)}</p>
                {hasChanges && draftValue !== originalValue && (
                  <p className="text-xs text-violet-500 line-through dark:text-violet-400/70">antes {formatCurrency(originalValue)}</p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Itens entregues</p>
              <div className="space-y-2">
                {selected.items.map((item) => {
                  if (removedIds.has(item.id)) {
                    return (
                      <div key={item.id} className="rounded-lg border border-dashed border-slate-200 px-3 py-2 dark:border-slate-700">
                        <div className="flex items-center justify-between text-xs text-slate-400 line-through dark:text-slate-500">
                          <span>{item.productName}{item.colorLabel && ` - ${item.colorLabel}`} · Será removido ao salvar</span>
                          <button
                            type="button"
                            onClick={() => setRemovedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next })}
                            className="font-medium text-violet-600 no-underline hover:underline dark:text-violet-400"
                          >
                            Desfazer
                          </button>
                        </div>
                        {item.saleReportsCount > 0 && (
                          <p className="mt-1 text-xs text-amber-600 no-underline dark:text-amber-400">
                            ⚠ Isso também vai apagar {item.saleReportsCount} relatório(s) de venda já registrado(s) contra este item ao salvar.
                          </p>
                        )}
                      </div>
                    )
                  }
                  const draft = drafts[item.id] ?? { quantity: item.quantityDelivered, unitPrice: item.unitPrice }
                  const changed = draft.quantity !== item.quantityDelivered || draft.unitPrice !== item.unitPrice
                  const floor = floorFor(item)
                  return (
                    <div key={item.id} className={`rounded-lg border p-2.5 ${changed ? 'border-amber-300 dark:border-amber-700' : 'border-slate-200 dark:border-slate-700'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                            {item.colorHex && <span style={{ background: item.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                            <span className="truncate">{item.productName}</span>
                            {changed && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">ALTERADO</span>}
                          </div>
                          {item.attrs.length > 0 ? (
                            <div className="mt-1.5">
                              <VariacaoPecas attrs={item.attrs} />
                            </div>
                          ) : item.colorLabel && (
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.colorLabel}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setRemovedIds((prev) => new Set(prev).add(item.id))}
                          aria-label="Remover"
                          title="Remover"
                          className="shrink-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-end gap-4">
                        <label className="text-xs text-slate-500 dark:text-slate-400">
                          <span className="mb-1 block">Qtd.</span>
                          <Stepper value={draft.quantity} min={Math.max(1, floor)} step={1} onChange={(v) => updateDraft(item.id, { quantity: v })} />
                        </label>
                        <label className="text-xs text-slate-500 dark:text-slate-400">
                          <span className="mb-1 block">Preço un.</span>
                          <Stepper value={draft.unitPrice} min={0} step={1} onChange={(v) => updateDraft(item.id, { unitPrice: v })} />
                        </label>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          <span className="mb-1 block">Subtotal</span>
                          <span className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(draft.quantity * draft.unitPrice)}</span>
                        </div>
                      </div>
                      {floor > 0 && (
                        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Já vendido/devolvido: {floor} (quantidade não pode ficar menor que isso)</p>
                      )}
                    </div>
                  )
                })}

                {newItems.map((n) => (
                  <div key={n.localId} className="rounded-lg border border-amber-300 p-2.5 dark:border-amber-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                          {n.colorHex && <span style={{ background: n.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                          <span className="truncate">{n.productName}</span>
                          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">NOVO</span>
                        </div>
                        {n.colorLabel && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{n.colorLabel}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewItems((prev) => prev.filter((x) => x.localId !== n.localId))}
                        aria-label="Remover"
                        title="Remover"
                        className="shrink-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-end gap-4">
                      <label className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="mb-1 block">Qtd.</span>
                        <Stepper value={n.quantity} min={1} step={1} onChange={(v) => setNewItems((prev) => prev.map((x) => (x.localId === n.localId ? { ...x, quantity: v } : x)))} />
                      </label>
                      <label className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="mb-1 block">Preço un.</span>
                        <Stepper value={n.unitPrice} min={0} step={1} onChange={(v) => setNewItems((prev) => prev.map((x) => (x.localId === n.localId ? { ...x, unitPrice: v } : x)))} />
                      </label>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="mb-1 block">Subtotal</span>
                        <span className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(n.quantity * n.unitPrice)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {addingProduct ? (
                <div className="mt-2">
                  <AddProductForm
                    products={products}
                    onAdd={(item) => { setNewItems((prev) => [...prev, item]); setAddingProduct(false) }}
                    onCancel={() => setAddingProduct(false)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingProduct(true)}
                  className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60"
                >
                  + Adicionar produto a esta entrega
                </button>
              )}
            </div>

            {hasChanges && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-900 dark:bg-amber-950/20">
                <p className="font-medium text-amber-800 dark:text-amber-300">{changeLines.length} {changeLines.length === 1 ? 'alteração ainda não salva' : 'alterações ainda não salvas'}</p>
                <ul className="mt-1 space-y-0.5 text-amber-700 dark:text-amber-400">
                  {changeLines.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-1 flex items-center justify-between gap-3">
              <ConfirmDeleteForm
                action={handleDeleteBatch}
                label="Excluir entrega"
                className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                confirmMessage={
                  selected.items.some((i) => i.saleReportsCount > 0)
                    ? 'Excluir esta entrega inteira? Isso também apaga todo relatório de venda já registrado contra ela.'
                    : 'Excluir esta entrega inteira?'
                }
              />
              <div className="flex gap-3">
                <button type="button" onClick={discard} disabled={!hasChanges} className="text-sm text-slate-500 hover:underline disabled:opacity-40 dark:text-slate-400">Descartar</button>
                <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Fechar</button>
                <button type="button" onClick={save} disabled={!hasChanges || isPending} className="tk-btn-primary px-3 py-1.5 text-sm disabled:opacity-40">
                  {isPending ? 'Salvando…' : 'Salvar alterações'}
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
