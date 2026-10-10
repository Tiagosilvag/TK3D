'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createConsignmentDeliveryBatch } from '@/actions/consignmentDeliveries'
import { formatCurrency } from '@/lib/format'
import { todayInBrasiliaString as today } from '@/lib/timezone'
import { SubmitButton } from '@/components/SubmitButton'
import { VariacaoPecas } from '@/components/VariacaoPecas'
import type { VariantAttr } from '@/lib/reports'

export interface PartnerOption {
  id: string
  name: string
}

export interface ProductVariantOption {
  key: string
  label: string
  colorHex: string | null
  available: number
  // Pedido do usuário "aqui deve aparecer a cor também, melhor de
  // localizar" (Entregas em consignação, mesmo problema já resolvido em
  // Pedidos): getProductVariantStockOptions já devolve isso, page.tsx
  // nunca descartava -- só faltava o componente usar em vez do texto
  // corrido (v.label).
  attrs: VariantAttr[]
}

export interface ProductOption {
  productId: string
  productName: string
  suggestedPrice: number | null
  variants: ProductVariantOption[]
}

interface ItemDraft {
  productId: string
  productName: string
  colorComboKey: string | null
  colorLabel: string | null
  colorHex: string | null
  quantity: number
  unitPrice: number
}

// Melhoria "Entregas em consignação" §1/§3: cadastro vira modal com um
// fluxo em passos -- escolher parceiro, "+ Adicionar produto" abre a lista
// de produtos, escolher um produto abre suas variantes de cor com estoque
// disponível (getProductVariantStockOptions), preencher quantidade de cada
// cor e confirmar volta pra lista principal do modal. Repete pra quantos
// produtos forem necessários numa mesma entrega -- tudo vira UMA submissão
// (createConsignmentDeliveryBatch), N linhas de ConsignmentDelivery
// compartilhando um batchId.
export function DeliveryBatchForm({
  open,
  onOpenChange,
  partners,
  products,
  defaultProductId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  partners: PartnerOption[]
  products: ProductOption[]
  // 2.2: link de ação rápida "Entregar a parceiro" em /stock chega aqui
  // com ?productId=... -- abre o modal já na tela de variantes daquele
  // produto, pulando a lista de escolha.
  defaultProductId?: string
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState<'form' | 'pickProduct' | 'pickVariant'>('form')
  const [partnerId, setPartnerId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [variantQuantities, setVariantQuantities] = useState<Record<string, string>>({})
  const [addUnitPrice, setAddUnitPrice] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (open && defaultProductId) {
      const product = products.find((p) => p.productId === defaultProductId)
      if (product) openVariantPicker(product)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na abertura inicial, não a cada render
  }, [open, defaultProductId])

  function resetAll() {
    setView('form')
    setPartnerId('')
    setDeliveryDate(today())
    setNotes('')
    setItems([])
    setSelectedProduct(null)
    setProductSearch('')
    setVariantQuantities({})
    setAddUnitPrice('')
  }

  function openVariantPicker(product: ProductOption) {
    setSelectedProduct(product)
    setVariantQuantities({})
    setAddUnitPrice(product.suggestedPrice != null ? String(product.suggestedPrice) : '')
    setView('pickVariant')
  }

  function confirmAddItems() {
    if (!selectedProduct) return
    const price = parseFloat(addUnitPrice)
    if (!Number.isFinite(price) || price <= 0) {
      alert('Informe um preço unitário válido')
      return
    }

    const newItems: ItemDraft[] = []
    if (selectedProduct.variants.length === 0) {
      const qty = parseInt(variantQuantities.__none__ ?? '', 10)
      if (Number.isFinite(qty) && qty > 0) {
        newItems.push({ productId: selectedProduct.productId, productName: selectedProduct.productName, colorComboKey: null, colorLabel: null, colorHex: null, quantity: qty, unitPrice: price })
      }
    } else {
      for (const v of selectedProduct.variants) {
        const qty = parseInt(variantQuantities[v.key] ?? '', 10)
        if (Number.isFinite(qty) && qty > 0) {
          newItems.push({ productId: selectedProduct.productId, productName: selectedProduct.productName, colorComboKey: v.key, colorLabel: v.label, colorHex: v.colorHex, quantity: qty, unitPrice: price })
        }
      }
    }

    if (newItems.length === 0) {
      alert('Informe a quantidade de pelo menos uma variação')
      return
    }

    setItems((prev) => [...prev, ...newItems])
    setSelectedProduct(null)
    // Pedido "melhorar a seleção de produtos, só dá pra adicionar 1 por
    // vez": antes, confirmar um produto voltava pro formulário inteiro --
    // uma entrega com vários produtos (comum, ver histórico de qualquer
    // parceiro) exigia clicar "+ Adicionar produto" e buscar de novo a
    // CADA produto. Agora volta direto pra lista de produtos, pronta pra
    // escolher o próximo sem sair do fluxo -- "Ver entrega" abaixo leva pro
    // formulário quando já tiver terminado de adicionar.
    setView('pickProduct')
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  // Pedido "melhorar essa também, pois não dá pra editar o valor, não tem
  // uma conferência final também": a lista "Itens desta entrega" só
  // mostrava nome+cor+quantidade em texto corrido, sem jeito de corrigir
  // preço (ou quantidade) sem excluir e refazer o produto inteiro desde o
  // picker -- e sem o preço de cada linha nem o subtotal, não dava pra
  // conferir o valor antes de enviar. Agora cada linha tem quantidade e
  // preço editáveis direto (state local, nada é gravado até "Registrar
  // entrega") + subtotal calculado, igual à conferência que Registrar
  // produção/Registrar venda já oferecem antes de confirmar.
  function updateItem(index: number, patch: Partial<Pick<ItemDraft, 'quantity' | 'unitPrice'>>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0)
  const totalValue = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)

  async function action() {
    if (!partnerId) {
      alert('Selecione um parceiro')
      return
    }
    if (items.length === 0) {
      alert('Adicione pelo menos um produto')
      return
    }
    // Quantidade/preço agora são editáveis na conferência final (acima) --
    // precisa revalidar aqui, diferente de antes (quando só confirmAddItems
    // gravava esses valores, já validados na hora).
    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        alert(`Quantidade inválida para "${item.productName}${item.colorLabel ? ` — ${item.colorLabel}` : ''}"`)
        return
      }
      if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
        alert(`Preço inválido para "${item.productName}${item.colorLabel ? ` — ${item.colorLabel}` : ''}"`)
        return
      }
    }
    const fd = new FormData()
    fd.set('partnerId', partnerId)
    fd.set('deliveryDate', deliveryDate)
    fd.set('notes', notes)
    fd.set('itemsJson', JSON.stringify(items.map((i) => ({
      productId: i.productId,
      colorComboKey: i.colorComboKey,
      quantityDelivered: i.quantity,
      unitPrice: i.unitPrice,
    }))))
    const result = await createConsignmentDeliveryBatch(fd)
    if (!result.success) {
      alert(result.error)
      return
    }
    onOpenChange(false)
    router.refresh()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => { onOpenChange(false); resetAll() }}
      className="w-full [--tk-dialog-cap:28rem] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {view === 'pickProduct' && (
        <div className="grid grid-cols-1 gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setView('form')} aria-label="Voltar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">←</button>
              <h3 className="font-display text-base font-semibold">Escolher produto</h3>
            </div>
            {items.length > 0 && (
              <button type="button" onClick={() => setView('form')} className="shrink-0 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                Ver entrega ({items.length})
              </button>
            )}
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
                visible.map((p) => {
                  // Pedido "melhorar a seleção de produtos": com o fluxo
                  // agora voltando direto pra esta lista a cada produto
                  // confirmado (ver confirmAddItems acima), um selo aqui
                  // mostra o que já foi adicionado nesta mesma entrega --
                  // sem isso, não dava pra saber de relance quais produtos
                  // já tinham sido feitos ao rolar a lista de novo.
                  const addedQty = items.filter((i) => i.productId === p.productId).reduce((sum, i) => sum + i.quantity, 0)
                  return (
                    <button
                      key={p.productId}
                      type="button"
                      onClick={() => openVariantPicker(p)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-violet-400 dark:border-slate-700 dark:hover:border-violet-500"
                    >
                      <span className="min-w-0 flex-1 break-words">{p.productName}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {addedQty > 0 && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                            {addedQty} adicionado{addedQty > 1 ? 's' : ''}
                          </span>
                        )}
                        <span aria-hidden className="text-slate-400">›</span>
                      </span>
                    </button>
                  )
                })
              )
            })()}
          </div>
        </div>
      )}

      {view === 'pickVariant' && selectedProduct && (
        <div className="grid grid-cols-1 gap-3 p-5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setView('pickProduct')} aria-label="Voltar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">←</button>
            <h3 className="font-display text-base font-semibold">{selectedProduct.productName}</h3>
          </div>

          {selectedProduct.variants.length > 0 ? (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">Informe a quantidade de cada variação disponível em estoque.</p>
              {/* Pedido "aqui também deve aparecer somente o que tem
                  disponível": uma variação com 0 em estoque não pode ser
                  entregue a um parceiro (não existe pra dar), então some
                  da lista em vez de aparecer com o campo desabilitado. */}
              {selectedProduct.variants.every((v) => v.available <= 0) && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  Nenhuma variação deste produto tem estoque disponível pra entregar.
                </p>
              )}
              <div className="space-y-2">
                {selectedProduct.variants.filter((v) => v.available > 0).map((v) => (
                  // Bug "modal esticada": rótulo de variante multi-cor pode ficar
                  // bem longo (ex.: "CANECA: BEGE/NUDE, CHOCOLATE: BRANCO + MARROM,
                  // CORAÇÃO: VERMELHO, CORRENTE — DOURADO, MOSQUETÃO: MARROM") --
                  // sem quebrar linha, empurrava a <dialog> pra muito além de
                  // max-w-md. min-w-0 + break-words deixa o texto quebrar dentro
                  // da largura fixa da modal em vez de alargá-la.
                  <div key={v.key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <span className="min-w-0 flex-1 text-sm">
                      {v.attrs.length > 0 ? (
                        <VariacaoPecas attrs={v.attrs} />
                      ) : (
                        <span className="flex items-start gap-2">
                          {v.colorHex && <span style={{ background: v.colorHex }} className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                          <span className="break-words font-medium text-slate-900 dark:text-slate-100">{v.label}</span>
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{v.available} em estoque</span>
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max={v.available}
                      placeholder="0"
                      value={variantQuantities[v.key] ?? ''}
                      onChange={(e) => setVariantQuantities((prev) => ({ ...prev, [v.key]: e.target.value }))}
                      className="tk-input w-20 shrink-0"
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <label className="text-sm">
              Quantidade
              <input
                type="number"
                step="1"
                min="1"
                value={variantQuantities.__none__ ?? ''}
                onChange={(e) => setVariantQuantities({ __none__: e.target.value })}
                className="tk-input-full"
              />
            </label>
          )}

          <label className="text-sm">
            Preço unitário
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={addUnitPrice}
              onChange={(e) => setAddUnitPrice(e.target.value)}
              className="tk-input-full"
            />
          </label>

          <button type="button" onClick={confirmAddItems} className="tk-btn-primary">
            Adicionar à entrega
          </button>
        </div>
      )}

      {view === 'form' && (
        <form action={action} className="grid grid-cols-1 gap-3 p-5">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Registrar entrega</h3>
            <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>

          <label className="text-sm">
            Parceiro
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="tk-input-full" required>
              <option value="" disabled>Selecione</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <div className="text-sm">
            <p className="font-medium text-slate-700 dark:text-slate-300">Itens desta entrega</p>
            {items.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Nenhum produto adicionado ainda.</p>
            ) : (
              <div className="mt-1.5 space-y-1.5">
                {items.map((item, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 flex-1 items-start gap-1.5 break-words text-sm">
                        {item.colorHex && <span style={{ background: item.colorHex }} className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                        <span>
                          {item.productName}
                          {item.colorLabel && <span className="text-slate-500 dark:text-slate-400"> - {item.colorLabel}</span>}
                        </span>
                      </span>
                      <button type="button" onClick={() => removeItem(i)} aria-label="Remover item" className="shrink-0 text-slate-400 hover:text-red-600 dark:hover:text-red-400">🗑</button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-xs text-slate-500 dark:text-slate-400">
                        Quantidade
                        <input
                          type="number"
                          step="1"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(i, { quantity: parseInt(e.target.value, 10) || 0 })}
                          className="tk-input-full"
                        />
                      </label>
                      <label className="text-xs text-slate-500 dark:text-slate-400">
                        Preço unit. (R$)
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(i, { unitPrice: parseFloat(e.target.value) || 0 })}
                          className="tk-input-full"
                        />
                      </label>
                    </div>
                    <p className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">{formatCurrency(item.quantity * item.unitPrice)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="button" onClick={() => { setProductSearch(''); setView('pickProduct') }} className="rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60">
            + Adicionar produto
          </button>

          <label className="text-sm">
            Data da entrega
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="tk-input-full" required />
          </label>

          <label className="text-sm">
            Observações (opcional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="tk-input-full" rows={2} />
          </label>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium dark:bg-slate-800/60">
            <span>Total da entrega</span>
            <span>{items.length > 0 ? `${totalUnits} un - ${formatCurrency(totalValue)}` : '—'}</span>
          </div>

          <div className="mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
            <SubmitButton pendingLabel="Salvando…">Registrar entrega</SubmitButton>
          </div>
        </form>
      )}
    </dialog>
  )
}
