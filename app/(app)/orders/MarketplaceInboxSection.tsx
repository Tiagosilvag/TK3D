'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ComboSelect } from '../assembly/ComboSelect'
import { confirmInboxOrder, ignoreInboxOrder } from '@/actions/mercadoLivreOrders'
import type { OrderProductOption } from './OrderForm'

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

  function setProduct(externalItemId: string, productId: string) {
    setMappings((prev) => ({ ...prev, [externalItemId]: { productId, colorComboKey: null } }))
  }

  function setColorComboKey(externalItemId: string, colorComboKey: string) {
    setMappings((prev) => ({
      ...prev,
      [externalItemId]: { productId: prev[externalItemId]?.productId ?? '', colorComboKey },
    }))
  }

  async function handleConfirm() {
    const ordered = order.items.map((item) => ({
      externalItemId: item.externalItemId,
      productId: mappings[item.externalItemId]?.productId ?? '',
      colorComboKey: mappings[item.externalItemId]?.colorComboKey ?? null,
    }))
    if (ordered.some((m) => !m.productId)) {
      alert('Escolha o produto de cada item antes de confirmar')
      return
    }
    const result = await confirmInboxOrder(order.id, ordered)
    if (!result.success) {
      alert(result.error)
      return
    }
    router.refresh()
  }

  async function handleIgnore() {
    await ignoreInboxOrder(order.id)
    router.refresh()
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="font-medium">
        Pedido #{order.externalOrderId} — {order.buyerName ?? 'comprador não identificado'} — R$ {order.totalAmount.toFixed(2)}
      </p>
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
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={handleConfirm} className="tk-btn-primary">Confirmar</button>
        <button type="button" onClick={handleIgnore} className="tk-link-danger">Ignorar</button>
      </div>
    </div>
  )
}
