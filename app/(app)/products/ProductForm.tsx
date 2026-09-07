'use client'
import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createProduct, updateProduct } from '@/actions/products'

type Option = { id: string; name: string }

const FINISHING_TYPES = [
  { value: 'NENHUM', label: 'Nenhum' },
  { value: 'CANETA_VERNIZ', label: 'Caneta de verniz' },
  { value: 'RESINA_UV', label: 'Resina UV' },
  { value: 'OUTRO', label: 'Outro' },
]

type ProductValues = {
  id: string
  name: string
  category: string
  printerId: string
  filamentId: string
  weightGrams: number
  printTimeHours: number
  laborTimeHours: number
  packagingItemId: string | null
  finishingType: string
  usesGlue: boolean
  notes: string | null
}

export function ProductForm({
  product,
  printers,
  filaments,
  packagingItems,
}: {
  product?: ProductValues
  printers: Option[]
  filaments: Option[]
  packagingItems: Option[]
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  async function action(formData: FormData) {
    const result = product ? await updateProduct(product.id, formData) : await createProduct(formData)
    if (result.success) {
      if (product) router.refresh()
      else formRef.current?.reset()
    } else {
      alert(result.error)
    }
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3 tk-panel p-4 md:grid-cols-3">
      <label className="text-sm">
        Nome
        <input name="name" defaultValue={product?.name} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Categoria
        <input name="category" defaultValue={product?.category ?? 'Chaveiro'} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Impressora
        <select name="printerId" defaultValue={product?.printerId ?? ''} className="tk-input-full" required>
          <option value="" disabled>Selecione</option>
          {printers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Filamento
        <select name="filamentId" defaultValue={product?.filamentId ?? ''} className="tk-input-full" required>
          <option value="" disabled>Selecione</option>
          {filaments.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Peso (g)
        <input name="weightGrams" type="number" step="0.01" defaultValue={product?.weightGrams} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Tempo de impressão (h)
        <input name="printTimeHours" type="number" step="0.001" defaultValue={product?.printTimeHours} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Tempo de mão de obra (h)
        <input name="laborTimeHours" type="number" step="0.001" defaultValue={product?.laborTimeHours} className="tk-input-full" required />
      </label>
      <label className="text-sm">
        Embalagem (opcional)
        <select name="packagingItemId" defaultValue={product?.packagingItemId ?? ''} className="tk-input-full">
          <option value="">Nenhuma</option>
          {packagingItems.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Acabamento
        <select name="finishingType" defaultValue={product?.finishingType ?? 'NENHUM'} className="tk-input-full" required>
          {FINISHING_TYPES.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="usesGlue" type="checkbox" value="true" defaultChecked={product?.usesGlue} className="rounded border" />
        Usa cola
      </label>
      <label className="col-span-full text-sm md:col-span-3">
        Observações (opcional)
        <textarea name="notes" defaultValue={product?.notes ?? ''} className="tk-input-full" rows={2} />
      </label>
      <button className="col-span-full mt-2 tk-btn-primary">
        {product ? 'Salvar alterações' : 'Adicionar'}
      </button>
    </form>
  )
}
