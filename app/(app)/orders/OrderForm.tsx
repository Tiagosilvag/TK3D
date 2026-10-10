'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createOrder, addOrderItems } from '@/actions/orders'
import { formatCurrency, ORDER_CHANNEL_LABELS } from '@/lib/format'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { chipClass } from '@/components/Chip'
import { Stepper } from '@/components/Stepper'
import { SubmitButton } from '@/components/SubmitButton'
import type { CustomVariantChoice } from './CustomVariantPicker'
import type { OrderReallocationEvent } from '@/lib/orderReservations'
import type { VariantAttr } from '@/lib/reports'
import { VariantCardPicker } from './VariantCardPicker'
import { VariacaoPecas } from '@/components/VariacaoPecas'

const CHANNELS = Object.entries(ORDER_CHANNEL_LABELS) as [keyof typeof ORDER_CHANNEL_LABELS, string][]

const DELIVERY_CHIPS = [
  { label: 'Hoje', days: 0 },
  { label: 'Amanhã', days: 1 },
  { label: 'Em 2 dias', days: 2 },
  { label: 'Em 4 dias', days: 4 },
  { label: 'Semana que vem', days: 7 },
]

function addDays(days: number): string {
  const d = new Date(`${today()}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Melhoria "Pedidos com múltiplos itens": mesmo shape de
// SaleForm.tsx#ProductVariantOption/ProductOption -- Pedidos escolhe
// cor/variação igual Vendas já fazia, pra poder reservar a variação certa
// (OrderItem.colorComboKey).
export interface OrderProductVariantOption {
  key: string
  label: string
  colorHex: string | null
  available: number
  // Redesign "Variação de peças em Pedidos": mesmo dado estruturado que
  // getProductVariantStockOptions já produz (lib/reports.ts) -- alimenta
  // VariantCardPicker/VariacaoPecas, substituindo o texto corrido único
  // (label) como exibição padrão.
  attrs: VariantAttr[]
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

function requiresColorChoice(product: OrderProductOption): boolean {
  return product.variants.length > 0 || product.needsAssembly
}

function genItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Redesign "Pedidos" §3 -- cartão de 1 item já adicionado ao pedido: chips
// de cor/variação (+ "✦ Personalizar cores" via CustomVariantPicker já
// existente), Stepper de quantidade/valor, aviso de estoque (quanto vai
// pra fila de produção) e "+ outra cor deste produto" (empilha uma 2ª
// linha do MESMO produto, pro caso de pedir cores diferentes de uma vez).
function ItemCard({
  draft,
  product,
  onChange,
  onRemove,
  onAddAnotherColor,
}: {
  draft: ItemDraft
  product: OrderProductOption
  onChange: (patch: Partial<ItemDraft>) => void
  onRemove: () => void
  onAddAnotherColor: () => void
}) {
  const needsColor = requiresColorChoice(product)
  const variant = draft.colorComboKey ? product.variants.find((v) => v.key === draft.colorComboKey) : undefined
  const available = draft.colorChoices ? 0 : (variant?.available ?? 0)
  const toProduce = Math.max(0, draft.quantity - available)
  // Redesign "Variação de peças em Pedidos" §2: picker de cards aberto por
  // padrão só enquanto nenhuma variação foi escolhida ainda -- depois de
  // escolhida, colapsa pra um resumo (VariacaoPecas quando a variante é
  // conhecida, com `attrs`; chip de texto só pra variação personalizada
  // recém-criada, que ainda não tem `attrs` estruturado no client).
  const [pickerOpen, setPickerOpen] = useState(!draft.colorComboKey && !draft.colorChoices)

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {draft.colorHex && <span style={{ background: draft.colorHex }} className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
          {product.productName}
        </span>
        <button type="button" onClick={onRemove} aria-label="Remover item" className="shrink-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400">🗑</button>
      </div>

      {needsColor && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">Variação</p>
            {!pickerOpen && (draft.colorComboKey || draft.colorChoices) && (
              <button type="button" onClick={() => setPickerOpen(true)} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                Trocar variação
              </button>
            )}
          </div>

          {!pickerOpen && (draft.colorComboKey || draft.colorChoices) ? (
            variant ? (
              <VariacaoPecas attrs={variant.attrs} />
            ) : (
              <span className={chipClass(true)}>{draft.colorLabel}</span>
            )
          ) : (
            <VariantCardPicker
              productId={product.productId}
              variants={product.variants}
              selectedKey={draft.colorComboKey}
              onSelect={(v) => { onChange({ colorComboKey: v.key, colorChoices: null, colorLabel: v.label, colorHex: v.colorHex }); setPickerOpen(false) }}
              onConfirmCustom={(choice: CustomVariantChoice) => { onChange({ colorComboKey: null, colorChoices: choice.choices, colorLabel: choice.label, colorHex: null }); setPickerOpen(false) }}
            />
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="mb-1 block">Quantidade</span>
          <Stepper value={draft.quantity} min={1} step={1} onChange={(v) => onChange({ quantity: v })} />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="mb-1 block">Valor unitário</span>
          <Stepper value={draft.unitPrice} min={0} step={1} onChange={(v) => onChange({ unitPrice: v })} />
        </label>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          <span className="mb-1 block">Subtotal</span>
          <span className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(draft.quantity * draft.unitPrice)}</span>
        </div>
      </div>

      {needsColor && (draft.colorComboKey || draft.colorChoices) && (
        <p className={`mt-1.5 text-xs ${toProduce > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {toProduce > 0 ? `✓ ${available} em estoque → ${toProduce} vão pra produção` : `✓ ${available} em estoque`}
        </p>
      )}

      {needsColor && (
        <button type="button" onClick={onAddAnotherColor} className="mt-2 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
          + Adicionar outra cor deste produto
        </button>
      )}
    </div>
  )
}

// Redesign "Pedidos" §3 -- fluxo de criação em UMA tela só (sem
// sub-modais): 3 seções numeradas (Cliente/Itens/Entrega) empilhadas no
// mesmo scroll, resumo+total ao vivo no rodapé. "existingOrder" continua
// sendo o modo mais simples de "+ Adicionar item a um pedido já existente"
// (só a seção de Itens aparece, sem cabeçalho/entrega -- esses já existem
// no pedido e nunca mudam por aqui).
export function OrderForm({
  open,
  onOpenChange,
  products,
  partners,
  recentBuyers,
  existingOrder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: OrderProductOption[]
  // Pedido do usuário "criar pedidos de encomendas de consignados também":
  // só parceiros ativos, mesmo padrão de outros seletores do app.
  partners: { id: string; name: string }[]
  // Redesign "Pedidos" §3 Cliente: chips derivados dos nomes mais
  // recentes/distintos de Order.buyerOrPlatform (getRecentOrderBuyers,
  // decisão confirmada com o usuário -- nunca uma tabela de Cliente nova).
  recentBuyers: string[]
  // Pedido do usuário "editar um pedido pra adicionar uma peça": quando
  // setado, o formulário esconde Cliente/Entrega (já existem no pedido,
  // nunca mudam por aqui) e confirmar chama addOrderItems(existingOrder.id,
  // ...) em vez de createOrder.
  existingOrder?: { id: string; orderNumber: string | null }
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [channel, setChannel] = useState('')
  const [buyerOrPlatform, setBuyerOrPlatform] = useState('')
  const [consignmentPartnerId, setConsignmentPartnerId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(today())
  const [orderNumber, setOrderNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [items, setItems] = useState<ItemDraft[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [reallocations, setReallocations] = useState<OrderReallocationEvent[] | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function resetForm() {
    setChannel('')
    setBuyerOrPlatform('')
    setConsignmentPartnerId('')
    setDeliveryDate(today())
    setOrderNumber('')
    setNotes('')
    setNotesOpen(false)
    setItems([])
    setProductSearch('')
  }

  // Tocar num chip de produto: cria o 1º item desse produto (qty 1) ou
  // soma +1 -- em produto de cor obrigatória, soma na ÚLTIMA cor
  // adicionada (criar outra cor é o botão dedicado dentro do card, não o
  // chip de produto).
  function tapProduct(product: OrderProductOption) {
    setItems((prev) => {
      const draftsForProduct = prev.filter((i) => i.productId === product.productId)
      if (draftsForProduct.length === 0) {
        return [...prev, {
          id: genItemId(),
          productId: product.productId,
          productName: product.productName,
          colorComboKey: null,
          colorChoices: null,
          colorLabel: null,
          colorHex: null,
          quantity: 1,
          unitPrice: 0,
        }]
      }
      const lastId = draftsForProduct[draftsForProduct.length - 1].id
      return prev.map((i) => (i.id === lastId ? { ...i, quantity: i.quantity + 1 } : i))
    })
  }

  function addAnotherColor(product: OrderProductOption) {
    setItems((prev) => [...prev, {
      id: genItemId(),
      productId: product.productId,
      productName: product.productName,
      colorComboKey: null,
      colorChoices: null,
      colorLabel: null,
      colorHex: null,
      quantity: 1,
      unitPrice: 0,
    }])
  }

  function updateItem(id: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const productChipCount = (productId: string) => items.filter((i) => i.productId === productId).reduce((sum, i) => sum + i.quantity, 0)

  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0)
  const totalValue = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const unitsToProduce = items.reduce((sum, i) => {
    const product = products.find((p) => p.productId === i.productId)
    if (!product || !requiresColorChoice(product)) return sum
    const variant = i.colorComboKey ? product.variants.find((v) => v.key === i.colorComboKey) : undefined
    const available = i.colorChoices ? 0 : (variant?.available ?? 0)
    return sum + Math.max(0, i.quantity - available)
  }, 0)

  async function action() {
    if (!existingOrder && !channel) {
      alert('Selecione o canal')
      return
    }
    if (!existingOrder && channel === 'CONSIGNADO' && !consignmentPartnerId) {
      alert('Selecione o parceiro de consignação')
      return
    }
    if (!existingOrder && channel !== 'CONSIGNADO' && !buyerOrPlatform.trim()) {
      alert('Informe o cliente')
      return
    }
    if (items.length === 0) {
      alert('Adicione pelo menos um item ao pedido')
      return
    }
    for (const item of items) {
      const product = products.find((p) => p.productId === item.productId)
      if (product && requiresColorChoice(product) && !item.colorComboKey && !item.colorChoices) {
        alert(`Selecione a cor/variação de ${product.productName}`)
        return
      }
      if (item.unitPrice <= 0) {
        alert(`Informe o valor unitário de ${item.productName}`)
        return
      }
    }
    const fd = new FormData()
    if (!existingOrder) {
      fd.set('channel', channel)
      fd.set('orderDate', today())
      fd.set('deliveryDate', deliveryDate)
      // Pedido do usuário "criar pedidos de encomendas de consignados
      // também": canal Consignado grava o nome do parceiro em
      // buyerOrPlatform automaticamente (sem pedir pra preencher duas
      // vezes) -- consignmentPartnerId é o dado estruturado de verdade
      // que o servidor usa.
      fd.set('buyerOrPlatform', channel === 'CONSIGNADO' ? (partners.find((p) => p.id === consignmentPartnerId)?.name ?? '') : buyerOrPlatform)
      fd.set('consignmentPartnerId', channel === 'CONSIGNADO' ? consignmentPartnerId : '')
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
    const reallocs = result.reallocations && result.reallocations.length > 0 ? result.reallocations : null
    if (reallocs) {
      resetForm()
      setReallocations(reallocs)
    } else {
      dialogRef.current?.close()
    }
  }

  const term = productSearch.trim().toLowerCase()
  const visibleProducts = term ? products.filter((p) => p.productName.toLowerCase().includes(term)) : products

  const canSubmit = items.length > 0 && (Boolean(existingOrder) || (channel === 'CONSIGNADO' ? Boolean(consignmentPartnerId) : Boolean(buyerOrPlatform.trim())))

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetForm() }}
      className="w-full [--tk-dialog-cap:34rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <h3 className="font-display text-base font-semibold">
            {existingOrder ? `Adicionar item${existingOrder.orderNumber ? ` — Pedido #${existingOrder.orderNumber}` : ''}` : 'Novo pedido'}
          </h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
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
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">1 · Cliente</p>
              <div className="flex flex-wrap gap-2">
                {recentBuyers.map((name) => (
                  <button key={name} type="button" onClick={() => setBuyerOrPlatform(name)} className={chipClass(buyerOrPlatform === name)}>
                    {name}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Canal *
                  <select value={channel} onChange={(e) => setChannel(e.target.value)} className="tk-input-full" required>
                    <option value="" disabled>Selecione</option>
                    {CHANNELS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                {channel === 'CONSIGNADO' ? (
                  <label className="text-sm">
                    Parceiro *
                    <select value={consignmentPartnerId} onChange={(e) => setConsignmentPartnerId(e.target.value)} className="tk-input-full" required>
                      <option value="" disabled>Selecione</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="text-sm">
                    Cliente (+ Novo cliente)
                    <input value={buyerOrPlatform} onChange={(e) => setBuyerOrPlatform(e.target.value)} placeholder="Nome do cliente" className="tk-input-full" />
                  </label>
                )}
                <label className="text-sm">
                  Número do pedido (opcional)
                  <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="tk-input-full" />
                </label>
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{existingOrder ? 'Itens a adicionar' : '2 · Itens'}</p>
            <input
              type="search"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Buscar produto..."
              className="tk-input-full"
            />
            <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {visibleProducts.map((p) => {
                const count = productChipCount(p.productId)
                return (
                  <button key={p.productId} type="button" onClick={() => tapProduct(p)} className={`relative ${chipClass(count > 0)}`}>
                    {p.productName}
                    {count > 0 && <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-[10px]">{count}</span>}
                  </button>
                )
              })}
              {visibleProducts.length === 0 && <p className="px-1 py-2 text-sm text-slate-400 dark:text-slate-500">Nenhum produto encontrado.</p>}
            </div>

            {items.length > 0 && (
              <div className="mt-3 space-y-2">
                {items.map((item) => {
                  const product = products.find((p) => p.productId === item.productId)
                  if (!product) return null
                  return (
                    <ItemCard
                      key={item.id}
                      draft={item}
                      product={product}
                      onChange={(patch) => updateItem(item.id, patch)}
                      onRemove={() => removeItem(item.id)}
                      onAddAnotherColor={() => addAnotherColor(product)}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {!existingOrder && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">3 · Entrega</p>
              <div className="flex flex-wrap items-center gap-2">
                {DELIVERY_CHIPS.map((c) => {
                  const value = addDays(c.days)
                  return (
                    <button key={c.label} type="button" onClick={() => setDeliveryDate(value)} className={chipClass(deliveryDate === value)}>
                      {c.label}
                    </button>
                  )
                })}
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="tk-input px-2 py-1 text-xs" />
              </div>
              {notesOpen ? (
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observação" className="tk-input-full mt-2" autoFocus />
              ) : (
                <button type="button" onClick={() => setNotesOpen(true)} className="mt-2 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                  + Adicionar observação
                </button>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            {!existingOrder && <>{buyerOrPlatform || '—'} · </>}
            {totalUnits > 0 ? `${totalUnits} un` : 'Nenhum item'} · {formatCurrency(totalValue)}
            {!existingOrder && deliveryDate && <> · entrega {new Date(`${deliveryDate}T00:00:00`).toLocaleDateString('pt-BR')}</>}
            {unitsToProduce > 0 && (
              <> · <span className="font-medium text-amber-600 dark:text-amber-400">{unitsToProduce} unidade{unitsToProduce === 1 ? '' : 's'} vai{unitsToProduce === 1 ? '' : 'ão'} pra fila de produção</span></>
            )}
          </div>
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
            <form action={action}>
              <SubmitButton pendingLabel="Salvando…" disabled={!canSubmit}>{existingOrder ? 'Adicionar ao pedido' : 'Criar pedido'}</SubmitButton>
            </form>
          </div>
        </div>
      </div>
    </dialog>
  )
}
