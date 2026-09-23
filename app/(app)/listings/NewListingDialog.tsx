'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createListingDraft } from '@/actions/listings'
import { getMarketplacePlatformBadge, LISTING_TYPE_LABELS } from '@/lib/format'
import { SubmitButton } from '@/components/SubmitButton'
import type { ListingType } from '@prisma/client'

const LISTING_TYPE_OPTIONS = Object.keys(LISTING_TYPE_LABELS) as ListingType[]

// Anúncios: "+ Novo anúncio" (toolbar) e "+ Criar anúncio" (linha de um
// produto sem anúncio) abrem o mesmo <dialog> nativo -- só produto
// pré-selecionado muda entre os dois casos. Cria já com preço/frete
// sugeridos (createListingDraft) e a linha nasce editável na tabela, sem
// formulário próprio por campo.
export function NewListingDialog({
  products,
  platforms,
  presetProductId,
  trigger,
}: {
  products: { id: string; name: string }[]
  platforms: { id: string; kind: 'SHOPEE' | 'MERCADO_LIVRE' }[]
  presetProductId?: string
  trigger: React.ReactNode
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [productId, setProductId] = useState(presetProductId ?? '')
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? '')
  const [listingType, setListingType] = useState<ListingType>('CLASSICO')
  const [error, setError] = useState<string | null>(null)

  const selectedPlatform = platforms.find((p) => p.id === platformId)
  const isMl = selectedPlatform?.kind === 'MERCADO_LIVRE'

  async function action() {
    if (!productId || !platformId) {
      setError('Selecione produto e plataforma')
      return
    }
    const result = await createListingDraft(productId, platformId, isMl ? listingType : undefined)
    if (!result.success) {
      setError(result.error ?? 'Erro ao criar anúncio')
      return
    }
    setError(null)
    dialogRef.current?.close()
    router.refresh()
  }

  return (
    <>
      <span onClick={() => dialogRef.current?.showModal()}>{trigger}</span>
      <dialog
        ref={dialogRef}
        onClose={() => setError(null)}
        className="w-80 rounded-xl border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-slate-950/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <form action={action} className="grid grid-cols-1 gap-3 p-4">
          <h3 className="font-display text-sm font-semibold">Novo anúncio</h3>
          {!presetProductId && (
            <label className="text-sm">
              Produto *
              <select value={productId} onChange={(e) => setProductId(e.target.value)} required className="tk-input-full">
                <option value="" disabled>Selecione</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm">
            Plataforma *
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} required className="tk-input-full">
              {platforms.map((p) => <option key={p.id} value={p.id}>{getMarketplacePlatformBadge(p.kind).label}</option>)}
            </select>
          </label>
          {isMl && (
            <label className="text-sm">
              Tipo de anúncio
              <select value={listingType} onChange={(e) => setListingType(e.target.value as ListingType)} className="tk-input-full">
                {LISTING_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{LISTING_TYPE_LABELS[t]}</option>)}
              </select>
            </label>
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-2 flex items-center justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
              Cancelar
            </button>
            <SubmitButton pendingLabel="Criando…">Criar anúncio</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
