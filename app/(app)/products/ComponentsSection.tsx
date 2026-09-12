'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import { SUPPLY_UNIT_SUFFIX } from '@/lib/format'
import {
  addProductSupplyUsage,
  removeProductSupplyUsage,
  addProductAccessoryUsage,
  removeProductAccessoryUsage,
  addProductPackagingUsage,
  removeProductPackagingUsage,
  addProductComponentUsage,
  removeProductComponentUsage,
} from '@/actions/products'
import type { SupplyUnit } from '@prisma/client'

// Melhoria "Produto-como-componente": 'PRODUCT' é outro Product usado como
// ingrediente (ex.: Mosquetão dentro de Chaveiro Café) -- mesmo fluxo
// "tipo → item → quantidade" que Acessório/Insumo/Embalagem já usam, só
// apontando pra addProductComponentUsage/removeProductComponentUsage.
type ComponentType = 'ACCESSORY' | 'SUPPLY' | 'PACKAGING' | 'PRODUCT'

const TYPE_LABELS: Record<ComponentType, string> = {
  ACCESSORY: 'Acessório',
  SUPPLY: 'Insumo',
  PACKAGING: 'Embalagem',
  PRODUCT: 'Produto',
}

export interface ComponentRow {
  id: string
  type: ComponentType
  name: string
  quantity: number
  unitSuffix: string
  cost: number
}

export interface AccessoryOption {
  id: string
  name: string
  colorName: string
}

export interface SupplyOption {
  id: string
  name: string
  unit: SupplyUnit
  defaultUsage: number | null
}

export interface PackagingOption {
  id: string
  name: string
}

// Melhoria "Produto-como-componente": outro Product elegível como
// ingrediente -- já filtrado no server (ativo, não-composto, excluindo o
// próprio produto); o servidor ainda revalida tudo isso de novo (mais o
// ciclo) em addProductComponentUsage.
export interface ProductOption {
  id: string
  name: string
}

function accessoryOptionLabel(a: AccessoryOption): string {
  return a.colorName ? `${a.name} — ${a.colorName}` : a.name
}

// Melhoria "Produtos" §3: uma ÚNICA lista "Componentes" pra Acessórios,
// Insumos e Embalagem (antes eram 3 seções/tabelas separadas) -- mesmo
// fluxo "escolher tipo → escolher item → quantidade" que o modal de
// Entregas em consignação já usa pra variante de cor (DeliveryBatchForm).
// Por baixo continuam sendo 3 tabelas/actions diferentes (ProductAccessoryUsage/
// ProductSupplyUsage/ProductPackagingUsage) -- só a apresentação é unificada.
export function ComponentsSection({
  productId,
  components,
  accessories,
  supplies,
  packagingItems,
  products,
}: {
  productId: string
  components: ComponentRow[]
  accessories: AccessoryOption[]
  supplies: SupplyOption[]
  packagingItems: PackagingOption[]
  products: ProductOption[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [type, setType] = useState<ComponentType>('ACCESSORY')
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')

  function resetAddForm() {
    setAdding(false)
    setType('ACCESSORY')
    setItemId('')
    setQuantity('')
  }

  function handleTypeChange(next: ComponentType) {
    setType(next)
    setItemId('')
    setQuantity('')
  }

  function handleItemChange(id: string) {
    setItemId(id)
    if (type === 'SUPPLY') {
      const supply = supplies.find((s) => s.id === id)
      setQuantity(supply?.defaultUsage != null ? String(supply.defaultUsage) : '')
    } else {
      setQuantity(quantity || '1')
    }
  }

  async function handleSubmit() {
    const qty = parseFloat(quantity)
    if (!itemId || !Number.isFinite(qty) || qty <= 0) {
      alert('Selecione um item e informe uma quantidade válida')
      return
    }
    const fd = new FormData()
    fd.set('productId', productId)
    fd.set('quantity', quantity)
    let result
    if (type === 'ACCESSORY') {
      fd.set('accessoryId', itemId)
      result = await addProductAccessoryUsage(fd)
    } else if (type === 'SUPPLY') {
      fd.set('supplyId', itemId)
      result = await addProductSupplyUsage(fd)
    } else if (type === 'PACKAGING') {
      fd.set('packagingItemId', itemId)
      result = await addProductPackagingUsage(fd)
    } else {
      fd.set('componentProductId', itemId)
      result = await addProductComponentUsage(fd)
    }
    if (!result.success) {
      alert(result.error)
      return
    }
    resetAddForm()
    router.refresh()
  }

  async function handleRemove(row: ComponentRow) {
    const action = row.type === 'ACCESSORY'
      ? removeProductAccessoryUsage
      : row.type === 'SUPPLY'
        ? removeProductSupplyUsage
        : row.type === 'PACKAGING'
          ? removeProductPackagingUsage
          : removeProductComponentUsage
    const result = await action(row.id)
    if (result.success) router.refresh()
  }

  const itemOptions: { id: string; label: string }[] =
    type === 'ACCESSORY'
      ? accessories.map((a) => ({ id: a.id, label: accessoryOptionLabel(a) }))
      : type === 'SUPPLY'
        ? supplies.map((s) => ({ id: s.id, label: s.name }))
        : type === 'PACKAGING'
          ? packagingItems.map((p) => ({ id: p.id, label: p.name }))
          : products.map((p) => ({ id: p.id, label: p.name }))

  const selectedSupply = type === 'SUPPLY' ? supplies.find((s) => s.id === itemId) : undefined

  return (
    <div className="mt-6 tk-panel p-4">
      <h2 className="mb-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">Componentes</h2>
      {components.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum componente cadastrado.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="tk-table-head-row">
              <th className="py-1">Tipo</th>
              <th>Componente</th>
              <th>Quantidade</th>
              <th>Custo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {components.map((row) => (
              <tr key={`${row.type}-${row.id}`} className="tk-row">
                <td className="py-1 text-slate-500 dark:text-slate-400">{TYPE_LABELS[row.type]}</td>
                <td>{row.name}</td>
                <td>{row.quantity}{row.unitSuffix}</td>
                <td>{formatCurrency(row.cost)}</td>
                <td>
                  <button type="button" onClick={() => handleRemove(row)} className="tk-link-danger">Remover</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <label className="text-xs">
            Tipo
            <select value={type} onChange={(e) => handleTypeChange(e.target.value as ComponentType)} className="tk-input-full mt-1">
              <option value="ACCESSORY">Acessório</option>
              <option value="SUPPLY">Insumo</option>
              <option value="PACKAGING">Embalagem</option>
              <option value="PRODUCT">Produto</option>
            </select>
          </label>
          <label className="text-xs">
            Item
            <select value={itemId} onChange={(e) => handleItemChange(e.target.value)} className="tk-input-full mt-1">
              <option value="" disabled>Selecione</option>
              {itemOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Quantidade
            <div className="mt-1 flex items-center gap-1">
              <input
                type="number"
                step={type === 'PRODUCT' ? '1' : '0.001'}
                min={type === 'PRODUCT' ? '1' : '0.001'}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="tk-input"
              />
              {selectedSupply && <span className="text-slate-400 dark:text-slate-500">{SUPPLY_UNIT_SUFFIX[selectedSupply.unit]}</span>}
            </div>
          </label>
          <div className="col-span-3 flex items-center gap-3">
            <button type="button" onClick={handleSubmit} className="tk-btn-primary">Adicionar</button>
            <button type="button" onClick={resetAddForm} className="text-sm text-slate-500 hover:underline dark:text-slate-400">Cancelar</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-violet-600 hover:bg-slate-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-slate-800/60"
        >
          + Adicionar componente
        </button>
      )}
    </div>
  )
}
