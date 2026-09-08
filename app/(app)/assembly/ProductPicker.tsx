'use client'
import { useRouter } from 'next/navigation'

export function ProductPicker({ productId, products }: { productId?: string; products: { id: string; name: string }[] }) {
  const router = useRouter()

  return (
    <label className="mb-4 block text-sm">
      Produto composto *
      <select
        defaultValue={productId ?? ''}
        onChange={(e) => router.push(e.target.value ? `/assembly?productId=${e.target.value}` : '/assembly')}
        className="tk-input-full max-w-md"
      >
        <option value="" disabled>Selecione</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  )
}
