'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createConsignmentDeliveryBatch } from '@/actions/consignmentDeliveries'
import { formatCurrency } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'

export interface PartnerOption {
  id: string
  name: string
}

export interface ProductVariantOption {
  key: string
  label: string
  colorHex: string | null
  available: number
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

function today(): string {
  return new Date().toISOString().slice(0, 10)
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
    setView('form')
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
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
      className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {view === 'pickProduct' && (
        <div className="grid gap-3 p-5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setView('form')} aria-label="Voltar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">←</button>
            <h3 className="font-display text-base font-semibold">Escolher produto</h3>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {products.map((p) => (
              <button
                key={p.productId}
                type="button"
                onClick={() => openVariantPicker(p)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-amber-400 dark:border-slate-700 dark:hover:border-amber-500"
              >
                {p.productName}
                <span aria-hidden className="text-slate-400">›</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'pickVariant' && selectedProduct && (
        <div className="grid gap-3 p-5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setView('pickProduct')} aria-label="Voltar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">←</button>
            <h3 className="font-display text-base font-semibold">{selectedProduct.productName}</h3>
          </div>

          {selectedProduct.variants.length > 0 ? (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">Informe a quantidade de cada variação disponível em estoque.</p>
              <div className="space-y-2">
                {selectedProduct.variants.map((v) => (
                  // Bug "modal esticada": rótulo de variante multi-cor pode ficar
                  // bem longo (ex.: "CANECA: BEGE/NUDE, CHOCOLATE: BRANCO + MARROM,
                  // CORAÇÃO: VERMELHO, CORRENTE — DOURADO, MOSQUETÃO: MARROM") --
                  // sem quebrar linha, empurrava a <dialog> pra muito além de
                  // max-w-md. min-w-0 + break-words deixa o texto quebrar dentro
                  // da largura fixa da modal em vez de alargá-la.
                  <div key={v.key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <span className="flex min-w-0 items-start gap-2 text-sm">
                      {v.colorHex && <span style={{ background: v.colorHex }} className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                      <span className="min-w-0">
                        <span className="break-words font-medium text-slate-900 dark:text-slate-100">{v.label}</span>
                        <span className="block text-xs text-slate-400 dark:text-slate-500">{v.available} em estoque</span>
                      </span>
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
        <form action={action} className="grid gap-3 p-5">
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
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <span className="flex items-center gap-2 text-sm">
                      {item.colorHex && <span style={{ background: item.colorHex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />}
                      {item.productName}{item.colorLabel && <span className="text-slate-500 dark:text-slate-400"> - {item.colorLabel}</span>} <span className="text-slate-500 dark:text-slate-400">x{item.quantity}</span>
                    </span>
                    <button type="button" onClick={() => removeItem(i)} aria-label="Remover item" className="text-slate-400 hover:text-red-600 dark:hover:text-red-400">🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="button" onClick={() => setView('pickProduct')} className="rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-amber-600 hover:bg-slate-50 dark:border-slate-700 dark:text-amber-400 dark:hover:bg-slate-800/60">
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
