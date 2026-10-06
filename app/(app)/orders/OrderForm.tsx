'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createOrder, addOrderItems } from '@/actions/orders'
import { formatCurrency, ORDER_CHANNEL_LABELS } from '@/lib/format'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { SubmitButton } from '@/components/SubmitButton'
import { CustomVariantPicker, type CustomVariantChoice } from './CustomVariantPicker'
import type { OrderReallocationEvent } from '@/lib/orderReservations'

const CHANNELS = Object.entries(ORDER_CHANNEL_LABELS) as [keyof typeof ORDER_CHANNEL_LABELS, string][]

// Melhoria "Pedidos com múltiplos itens": mesmo shape de
// SaleForm.tsx#ProductVariantOption/ProductOption -- Pedidos escolhe
// cor/variação igual Vendas já fazia, pra poder reservar a variação certa
// (OrderItem.colorComboKey).
export interface OrderProductVariantOption {
  key: string
  label: string
  colorHex: string | null
  available: number
}

export interface OrderProductOption {
  productId: string
  productName: string
  needsAssembly: boolean
  variants: OrderProductVariantOption[]
}

interface ItemDraft {
  id: string
  productId: string
  productName: string
  colorComboKey: string | null
  colorChoices: Record<string, string> | null
  colorLabel: string | null
  colorHex: string | null
  quantity: number
  unitPrice: number
}

// Melhoria "Pedidos com múltiplos itens" §1-3: cadastro vira modal com um
// fluxo em passos (mesmo padrão de DeliveryBatchForm.tsx em Entregas de
// consignação) -- dados do cabeçalho preenchidos uma vez, "+ Adicionar
// item" abre a lista de produtos, escolher um produto abre suas
// variantes de cor (conhecidas -- "Disponível agora"/"Sob encomenda" -- ou
// "+ Criar nova variação" via CustomVariantPicker, peça a peça), preencher
// quantidade/valor e confirmar volta pra lista principal do modal. Repete
// pra quantos itens forem necessários -- tudo vira UMA submissão
// (createOrder), 1 Order (cabeçalho) + N OrderItem compartilhando esse
// cabeçalho.
export function OrderForm({
  open,
  onOpenChange,
  products,
  existingOrder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: OrderProductOption[]
  // Pedido do usuário "editar um pedido pra adicionar uma peça": quando
  // setado, a modal esconde os campos de cabeçalho (canal/datas/comprador/
  // número/observações já existem no pedido, nunca mudam por aqui) e
  // confirmar chama addOrderItems(existingOrder.id, ...) em vez de
  // createOrder -- todo o resto do fluxo (escolher produto, cor/variação,
  // "+ Adicionar outra cor", editar item antes de confirmar) é o mesmo.
  existingOrder?: { id: string; orderNumber: string | null }
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState<'form' | 'pickProduct' | 'pickVariant'>('form')

  const [channel, setChannel] = useState('')
  const [buyerOrPlatform, setBuyerOrPlatform] = useState('')
  const [orderDate, setOrderDate] = useState(today())
  const [deliveryDate, setDeliveryDate] = useState(today())
  const [orderNumber, setOrderNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([])
  const [reallocations, setReallocations] = useState<OrderReallocationEvent[] | null>(null)

  const [selectedProduct, setSelectedProduct] = useState<OrderProductOption | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [addColorComboKey, setAddColorComboKey] = useState('')
  const [addCustomChoice, setAddCustomChoice] = useState<CustomVariantChoice | null>(null)
  const [addQuantity, setAddQuantity] = useState('1')
  const [addUnitPrice, setAddUnitPrice] = useState('')
  // Bug "não dá pra editar um item já adicionado": clicar no lápis de uma
  // linha de `items` preenche editingItemId + os campos acima com os
  // valores dela e abre o MESMO painel "pickVariant" de adicionar --
  // confirmAddItem substitui a linha existente em vez de criar outra
  // quando editingItemId está setado.
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  // Pedido "adicionar várias cores do mesmo produto, mais rápido":
  // "+ Adicionar outra cor" empilha a cor/quantidade atual aqui e limpa só
  // a cor+quantidade (mantém o valor unitário, geralmente igual pras
  // várias cores) pra escolher a próxima -- confirmAddItem no fim soma
  // isso tudo + a última cor preenchida de uma vez só. Só faz sentido no
  // fluxo de ADICIONAR (nunca usado durante edição de 1 item existente).
  const [pendingLines, setPendingLines] = useState<ItemDraft[]>([])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function resetForm() {
    setView('form')
    setChannel('')
    setBuyerOrPlatform('')
    setOrderDate(today())
    setDeliveryDate(today())
    setOrderNumber('')
    setNotes('')
    setItems([])
    setProductSearch('')
    setEditingItemId(null)
    setPendingLines([])
  }

  function openVariantPicker(product: OrderProductOption) {
    setSelectedProduct(product)
    setEditingItemId(null)
    setPendingLines([])
    setAddColorComboKey('')
    setAddCustomChoice(null)
    setAddQuantity('1')
    setAddUnitPrice('')
    setView('pickVariant')
  }

  // Abre o mesmo painel de adicionar item, pré-preenchido com os valores
  // da linha clicada -- trocar de produto ali dentro (via "←" até
  // "Escolher produto") também funciona, editingItemId continua setado.
  function openEditItem(item: ItemDraft) {
    const product = products.find((p) => p.productId === item.productId)
    if (!product) return
    setSelectedProduct(product)
    setEditingItemId(item.id)
    setPendingLines([])
    setAddColorComboKey(item.colorChoices ? '' : (item.colorComboKey ?? ''))
    setAddCustomChoice(item.colorChoices ? { label: item.colorLabel ?? '', choices: item.colorChoices } : null)
    setAddQuantity(String(item.quantity))
    setAddUnitPrice(String(item.unitPrice))
    setView('pickVariant')
  }

  const requiresColorChoice = Boolean(selectedProduct && (selectedProduct.variants.length > 0 || selectedProduct.needsAssembly))

  function genItemId(): string {
    return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  // Valida e monta UMA linha a partir dos campos atuais (cor/quantidade/
  // valor) -- usado tanto por "+ Adicionar outra cor" (empilha e segue
  // escolhendo) quanto pelo botão final (fecha com a última cor + tudo
  // empilhado). `alert` só dispara aqui, nunca duas vezes pro mesmo clique.
  function buildCurrentLine(): ItemDraft | null {
    if (!selectedProduct) return null
    if (requiresColorChoice && !addColorComboKey && !addCustomChoice) {
      alert('Selecione a cor/variação pedida')
      return null
    }
    const qty = parseInt(addQuantity, 10)
    const price = parseFloat(addUnitPrice)
    if (!Number.isFinite(qty) || qty <= 0) {
      alert('Informe uma quantidade válida')
      return null
    }
    if (!Number.isFinite(price) || price <= 0) {
      alert('Informe um valor unitário válido')
      return null
    }
    const variant = addColorComboKey ? selectedProduct.variants.find((v) => v.key === addColorComboKey) : undefined
    return {
      id: editingItemId ?? genItemId(),
      productId: selectedProduct.productId,
      productName: selectedProduct.productName,
      colorComboKey: addCustomChoice ? null : (addColorComboKey || null),
      colorChoices: addCustomChoice ? addCustomChoice.choices : null,
      colorLabel: addCustomChoice ? addCustomChoice.label : (variant?.label ?? null),
      colorHex: variant?.colorHex ?? null,
      quantity: qty,
      unitPrice: price,
    }
  }

  function queueAnotherColor() {
    const line = buildCurrentLine()
    if (!line) return
    setPendingLines((prev) => [...prev, line])
    setAddColorComboKey('')
    setAddCustomChoice(null)
    setAddQuantity('1')
    // addUnitPrice fica como está de propósito -- normalmente é o mesmo
    // valor pras várias cores do mesmo produto, menos digitação.
  }

  function removePendingLine(id: string) {
    setPendingLines((prev) => prev.filter((l) => l.id !== id))
  }

  function confirmAddItem() {
    const line = buildCurrentLine()
    if (!line) return
    if (editingItemId) {
      setItems((prev) => prev.map((i) => (i.id === editingItemId ? line : i)))
    } else {
      setItems((prev) => [...prev, ...pendingLines, line])
    }
    setSelectedProduct(null)
    setEditingItemId(null)
    setPendingLines([])
    setView('form')
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0)
  const totalValue = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)

  async function action() {
    if (!existingOrder && !channel) {
      alert('Selecione o canal')
      return
    }
    if (items.length === 0) {
      alert('Adicione pelo menos um item ao pedido')
      return
    }
    const fd = new FormData()
    if (!existingOrder) {
      fd.set('channel', channel)
      fd.set('orderDate', orderDate)
      fd.set('deliveryDate', deliveryDate)
      fd.set('buyerOrPlatform', buyerOrPlatform)
      fd.set('orderNumber', orderNumber)
      fd.set('notes', notes)
    }
    fd.set('itemsJson', JSON.stringify(items.map((i) => ({
      productId: i.productId,
      colorComboKey: i.colorChoices ? null : i.colorComboKey,
      colorChoicesJson: i.colorChoices ? JSON.stringify(i.colorChoices) : undefined,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    }))))
    const result = existingOrder ? await addOrderItems(existingOrder.id, fd) : await createOrder(fd)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.refresh()
    // Bug "modal não fecha nem avisa que foi criado": sem realocação pra
    // mostrar, fecha a modal igual todo outro cadastro do app (mesmo
    // padrão de ProductsExplorer.tsx etc.) -- o pedido já aparece na lista
    // por trás (router.refresh() acima), essa é a confirmação. Com
    // realocação, mantém aberta (reseta os campos pra um pedido novo) só
    // pra garantir que o aviso âmbar seja visto antes de sumir.
    const reallocs = result.reallocations && result.reallocations.length > 0 ? result.reallocations : null
    if (reallocs) {
      resetForm()
      setReallocations(reallocs)
    } else {
      dialogRef.current?.close()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetForm() }}
      className="w-full [--tk-dialog-cap:32rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {view === 'pickProduct' && (
        <div className="grid grid-cols-1 gap-3 p-5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setView('form')} aria-label="Voltar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">←</button>
            <h3 className="font-display text-base font-semibold">Escolher produto</h3>
          </div>
          <input
            autoFocus
            type="search"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Buscar produto..."
            className="tk-input-full"
          />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {(() => {
              const term = productSearch.trim().toLowerCase()
              const visible = term ? products.filter((p) => p.productName.toLowerCase().includes(term)) : products
              return visible.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum produto encontrado.</p>
              ) : (
                visible.map((p) => (
                  <button
                    key={p.productId}
                    type="button"
                    onClick={() => openVariantPicker(p)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-violet-400 dark:border-slate-700 dark:hover:border-violet-500"
                  >
                    {p.productName}
                    <span aria-hidden className="text-slate-400">›</span>
                  </button>
                ))
              )
            })()}
          </div>
        </div>
      )}

      {view === 'pickVariant' && selectedProduct && (
        <div className="grid grid-cols-1 gap-3 p-5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setView('pickProduct')} aria-label="Voltar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">←</button>
            <h3 className="font-display text-base font-semibold">{editingItemId ? `Editar item — ${selectedProduct.productName}` : selectedProduct.productName}</h3>
          </div>

          {/* Pedido "adicionar várias cores do mesmo produto, mais rápido":
              cada clique em "+ Adicionar outra cor" empilha aqui -- essa
              lista só existe durante o fluxo de ADICIONAR (nunca ao editar
              1 item já existente). */}
          {pendingLines.length > 0 && (
            <div className="space-y-1.5">
              {pendingLines.map((line) => (
                <div key={line.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm dark:bg-slate-800/60">
                  <span className="flex min-w-0 items-center gap-2">
                    {line.colorHex && <span style={{ background: line.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                    <span className="min-w-0 truncate">{line.colorLabel ?? 'Sem cor'} <span className="text-slate-500 dark:text-slate-400">x{line.quantity}</span></span>
                  </span>
                  <button type="button" onClick={() => removePendingLine(line.id)} aria-label="Remover cor" className="shrink-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400">🗑</button>
                </div>
              ))}
            </div>
          )}

          {requiresColorChoice && (
            <div className="text-sm">
              <span className="mb-1 block">Cor/Variação *</span>
              {addCustomChoice ? (
                <div className="flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-sm dark:border-violet-700 dark:bg-violet-500/10">
                  <span className="min-w-0 flex-1 truncate text-violet-800 dark:text-violet-300">{addCustomChoice.label || 'Personalizado'}</span>
                  <button type="button" onClick={() => setAddCustomChoice(null)} className="shrink-0 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300">
                    Trocar
                  </button>
                </div>
              ) : (
                <>
                  {selectedProduct.variants.length > 0 && (
                    <select value={addColorComboKey} onChange={(e) => setAddColorComboKey(e.target.value)} className="tk-input-full">
                      <option value="" disabled>Selecione a cor</option>
                      {selectedProduct.variants.map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.label} ({v.available} {v.available === 1 ? 'disponível' : 'disponíveis'})
                        </option>
                      ))}
                    </select>
                  )}
                  {/* Bug "sem opção de variação nova pra produto simples": antes só
                      aparecia pra produto que precisa de montagem -- mas pedir
                      uma cor ainda não produzida faz sentido pra QUALQUER
                      produto com Cor/Variação obrigatória (requiresColorChoice
                      já garante isso, nem precisa repetir a condição aqui).
                      resolveCustomColorComboKey (actions/orders.ts) grava no
                      formato certo pros dois casos. */}
                  <CustomVariantPicker
                    key={selectedProduct.productId}
                    productId={selectedProduct.productId}
                    onConfirm={(choice) => { setAddCustomChoice(choice); setAddColorComboKey('') }}
                    trigger={
                      <button type="button" className="mt-1 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                        + Criar nova variação
                      </button>
                    }
                  />
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Quantidade
              <input type="number" step="1" min="1" value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)} className="tk-input-full" />
            </label>
            <label className="text-sm">
              Valor unitário
              <input type="number" step="0.01" min="0.01" value={addUnitPrice} onChange={(e) => setAddUnitPrice(e.target.value)} className="tk-input-full" />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            {!editingItemId && requiresColorChoice && (
              <button type="button" onClick={queueAnotherColor} className="rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60">
                + Adicionar outra cor deste produto
              </button>
            )}
            <button type="button" onClick={confirmAddItem} className="tk-btn-primary">
              {editingItemId ? 'Salvar alterações' : pendingLines.length > 0 ? `Adicionar ${pendingLines.length + 1} itens ao pedido` : 'Adicionar item'}
            </button>
          </div>
        </div>
      )}

      {view === 'form' && (
        <form action={action} className="grid grid-cols-1 gap-3 p-5">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">
              {existingOrder ? `Adicionar item${existingOrder.orderNumber ? ` — Pedido #${existingOrder.orderNumber}` : ''}` : 'Novo pedido'}
            </h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>

          {reallocations && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">⚠ Peça realocada</p>
                  <ul className="mt-1 list-disc pl-4">
                    {reallocations.map((r, i) => (
                      <li key={i}>
                        {r.quantity} unidade{r.quantity === 1 ? '' : 's'} que estava{r.quantity === 1 ? '' : 'm'} reservada{r.quantity === 1 ? '' : 's'} pro pedido {r.fromOrderNumber ? `#${r.fromOrderNumber}` : '(sem número)'} (prazo mais longe) {r.quantity === 1 ? 'passou' : 'passaram'} pra este pedido, mais urgente.
                      </li>
                    ))}
                  </ul>
                </div>
                <button type="button" onClick={() => setReallocations(null)} aria-label="Fechar aviso" className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400">✕</button>
              </div>
            </div>
          )}

          {!existingOrder && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Canal *
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className="tk-input-full" required>
                  <option value="" disabled>Selecione</option>
                  {CHANNELS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Comprador (opcional)
                <input value={buyerOrPlatform} onChange={(e) => setBuyerOrPlatform(e.target.value)} className="tk-input-full" />
              </label>
              <label className="text-sm">
                Data do pedido *
                <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="tk-input-full" required />
              </label>
              <label className="text-sm">
                Data de entrega *
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="tk-input-full" required />
              </label>
              <label className="text-sm">
                Número do pedido (opcional)
                <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="tk-input-full" />
              </label>
              <label className="text-sm">
                Observações (opcional)
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className="tk-input-full" />
              </label>
            </div>
          )}

          <div className="text-sm">
            <p className="font-medium text-slate-700 dark:text-slate-300">{existingOrder ? 'Itens a adicionar' : 'Itens deste pedido'}</p>
            {items.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Nenhum item adicionado ainda.</p>
            ) : (
              <div className="mt-1.5 space-y-1.5">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <button type="button" onClick={() => openEditItem(item)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline">
                      {item.colorHex && <span style={{ background: item.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                      <span className="min-w-0 truncate">
                        {item.productName}{item.colorLabel && <span className="text-slate-500 dark:text-slate-400"> - {item.colorLabel}</span>} <span className="text-slate-500 dark:text-slate-400">x{item.quantity}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm text-slate-500 dark:text-slate-400">{formatCurrency(item.quantity * item.unitPrice)}</span>
                      <button type="button" onClick={() => openEditItem(item)} aria-label="Editar item" title="Editar" className="text-slate-400 hover:text-violet-600 dark:hover:text-violet-400">✎</button>
                      <button type="button" onClick={() => removeItem(item.id)} aria-label="Remover item" className="text-slate-400 hover:text-red-600 dark:hover:text-red-400">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="button" onClick={() => { setProductSearch(''); setView('pickProduct') }} className="rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60">
            + Adicionar item
          </button>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium dark:bg-slate-800/60">
            <span>{existingOrder ? 'Valor dos itens a adicionar' : 'Valor total do pedido'}</span>
            <span>{items.length > 0 ? `${totalUnits} un - ${formatCurrency(totalValue)}` : '—'}</span>
          </div>

          <div className="mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
            <SubmitButton pendingLabel="Salvando…">{existingOrder ? 'Adicionar ao pedido' : 'Finalizar pedido'}</SubmitButton>
          </div>
        </form>
      )}
    </dialog>
  )
}
