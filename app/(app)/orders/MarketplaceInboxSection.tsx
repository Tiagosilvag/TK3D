'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ComboSelect } from '../assembly/ComboSelect'
import { confirmInboxOrder, ignoreInboxOrder } from '@/actions/mercadoLivreOrders'
import type { OrderReallocationEvent } from '@/lib/orderReservations'
import type { OrderProductOption } from './OrderForm'

// Finding 4 (revisão final): data padrão do seletor de prazo de entrega --
// hoje + 3 dias (mesma lógica "razoável, mas sempre editável" de
// OrderForm.tsx, que também não trava numa data fixa). Formata em
// YYYY-MM-DD (fuso local, não UTC) pro valor de um <input type="date">.
function defaultDeliveryDateInput(): string {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

interface InboxItem {
  externalItemId: string
  title: string
  sku: string | null
  quantity: number
  unitPrice: number
}

export interface InboxOrder {
  id: string
  externalOrderId: string
  buyerName: string | null
  totalAmount: number
  items: InboxItem[]
}

// Caixa de entrada de pedidos Mercado Livre (Task 10): defeito real do
// brief -- ComboSelect só escolhe uma COR dentro de uma lista de combos já
// conhecida de um produto já escolhido, não tem noção de "produto" (ver
// assinatura real em ComboSelect.tsx). Resolução: reusa o mesmo array
// `products` (OrderProductOption[], igual OrderForm/OrdersExplorer já
// recebem via page.tsx) -- um <select> nativo simples escolhe o produto
// (tela de confirmação interna, menor risco, não é o fluxo principal de
// criar pedido -- não vale reimplementar o modal multi-etapa de
// OrderForm aqui), e só DEPOIS de escolhido, se `variants.length > 0`,
// aparece o ComboSelect de verdade pra escolher a cor. Produto simples
// sem variante (`variants.length === 0`) não mostra seletor de cor --
// colorComboKey fica null.
export function MarketplaceInboxSection({ pendingOrders, products }: { pendingOrders: InboxOrder[]; products: OrderProductOption[] }) {
  if (pendingOrders.length === 0) return null

  return (
    <section className="tk-panel mb-4 p-4">
      <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Pedidos Mercado Livre pendentes</h2>
      <div className="mt-2 space-y-3">
        {pendingOrders.map((order) => (
          <InboxOrderRow key={order.id} order={order} products={products} />
        ))}
      </div>
    </section>
  )
}

function InboxOrderRow({ order, products }: { order: InboxOrder; products: OrderProductOption[] }) {
  const router = useRouter()
  const [mappings, setMappings] = useState<Record<string, { productId: string; colorComboKey: string | null }>>({})
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDateInput)
  const [reallocations, setReallocations] = useState<OrderReallocationEvent[] | null>(null)
  // Finding 5 (revisão final, melhoria de UX -- não substitui a trava
  // atômica do lado do servidor, que é o que de fato impede o duplo
  // registro): desabilita os botões enquanto a ação está em voo, pra um
  // duplo-clique comum nem chegar a disparar a segunda requisição.
  const [isPending, startTransition] = useTransition()

  function setProduct(externalItemId: string, productId: string) {
    setMappings((prev) => ({ ...prev, [externalItemId]: { productId, colorComboKey: null } }))
  }

  function setColorComboKey(externalItemId: string, colorComboKey: string) {
    setMappings((prev) => ({
      ...prev,
      [externalItemId]: { productId: prev[externalItemId]?.productId ?? '', colorComboKey },
    }))
  }

  function handleConfirm() {
    const ordered = order.items.map((item) => ({
      externalItemId: item.externalItemId,
      productId: mappings[item.externalItemId]?.productId ?? '',
      colorComboKey: mappings[item.externalItemId]?.colorComboKey ?? null,
    }))
    if (ordered.some((m) => !m.productId)) {
      alert('Escolha o produto de cada item antes de confirmar')
      return
    }
    if (!deliveryDate) {
      alert('Escolha o prazo de entrega antes de confirmar')
      return
    }
    // Mesma convenção de orderHeaderSchema (lib/validation/order.ts,
    // z.coerce.date() sobre um <input type="date">): `new Date('YYYY-MM-DD')`
    // vira meia-noite UTC, igual todo outro deliveryDate do app -- nenhuma
    // correção de fuso especial aqui, só consistência com o resto.
    const parsedDeliveryDate = new Date(deliveryDate)
    startTransition(async () => {
      const result = await confirmInboxOrder(order.id, ordered, parsedDeliveryDate)
      if (!result.success) {
        alert(result.error)
        return
      }
      setReallocations(result.reallocations && result.reallocations.length > 0 ? result.reallocations : null)
      router.refresh()
    })
  }

  function handleIgnore() {
    startTransition(async () => {
      const result = await ignoreInboxOrder(order.id)
      if (!result.success) {
        alert(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="font-medium">
        Pedido #{order.externalOrderId} — {order.buyerName ?? 'comprador não identificado'} — R$ {order.totalAmount.toFixed(2)}
      </p>

      {reallocations && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
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

      <div className="mt-2 space-y-2">
        {order.items.map((item) => {
          const mapping = mappings[item.externalItemId]
          const selectedProduct = mapping ? products.find((p) => p.productId === mapping.productId) ?? null : null
          return (
            <div key={item.externalItemId} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm">{item.title} (x{item.quantity})</span>
              <select
                value={mapping?.productId ?? ''}
                onChange={(e) => setProduct(item.externalItemId, e.target.value)}
                disabled={isPending}
                className="tk-input-full max-w-xs"
              >
                <option value="" disabled>Selecione o produto</option>
                {products.map((p) => (
                  <option key={p.productId} value={p.productId}>{p.productName}</option>
                ))}
              </select>
              {selectedProduct && selectedProduct.variants.length > 0 && (
                <div className="w-full max-w-xs sm:w-56">
                  <ComboSelect
                    options={selectedProduct.variants}
                    value={mapping?.colorComboKey ?? ''}
                    onChange={(key) => setColorComboKey(item.externalItemId, key)}
                    allowUnavailable
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          Prazo de entrega
          <input
            type="date"
            required
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            disabled={isPending}
            className="tk-input-full ml-2 inline-block w-auto"
          />
        </label>
        <button type="button" onClick={handleConfirm} disabled={isPending} className="tk-btn-primary">Confirmar</button>
        <button type="button" onClick={handleIgnore} disabled={isPending} className="tk-link-danger">Ignorar</button>
      </div>
    </div>
  )
}
