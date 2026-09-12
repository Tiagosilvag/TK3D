'use client'
import { useActionState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { addProductPhoto, removeProductPhoto, setProductCoverPhoto } from '@/actions/productPhotos'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'
import { SubmitButton } from '@/components/SubmitButton'

export interface PhotoItem {
  id: string
  isCover: boolean
}

type ActionResult = { success: boolean; error?: string }

// Bug fix: this form used to be a bare inline server action
// (`async (formData) => { 'use server'; await addProductPhoto(formData) }`)
// on the Server Component page, discarding whatever addProductPhoto
// returned. addProductPhoto trivially returns { success: false, error } for
// a wrong file type or a file over 5MB -- the accept="" attribute is only a
// picker hint, not an enforced constraint -- so clicking Enviar on a
// rejected file looked like nothing happened. useActionState here captures
// that return value and shows it, and resets the file input on success
// (uncontrolled, so it never clears itself).
export function PhotoUploadForm({ productId }: { productId: string }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [result, formAction] = useActionState<ActionResult | null, FormData>(async (_prev, formData) => {
    const res = await addProductPhoto(formData)
    if (res.success) {
      formRef.current?.reset()
      router.refresh()
      return null
    }
    return res
  }, null)

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input
        type="file"
        name="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        required
        className="tk-input flex-1 file:mr-3 file:rounded-md file:border-0 file:bg-violet-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white dark:file:bg-violet-500 dark:file:text-slate-950"
      />
      <SubmitButton pendingLabel="Enviando…" className="tk-btn-primary shrink-0 px-4">Enviar</SubmitButton>
      {result?.error && <p className="w-full text-xs text-red-600 dark:text-red-400">{result.error}</p>}
    </form>
  )
}

// Melhoria "Produtos" §3: clicar numa foto marca ela como capa (mostrada no
// card da listagem) -- não existe upload separado de "foto de capa", é
// sempre uma das fotos já enviadas abaixo. Sem confirmação (é reversível a
// qualquer momento, só clicar em outra).
export function PhotoGallery({ photos, productName }: { photos: PhotoItem[]; productName: string }) {
  const router = useRouter()

  async function handleSetCover(photoId: string) {
    await setProductCoverPhoto(photoId)
    router.refresh()
  }

  return (
    <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
      {photos.map((photo) => (
        <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => handleSetCover(photo.id)}
            className="block w-full"
            title={photo.isCover ? 'Foto de capa' : 'Marcar como capa'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, not a static/optimizable asset */}
            <img
              src={`/api/photos/${photo.id}`}
              alt={`Foto de ${productName}`}
              className={`aspect-square w-full object-cover ${photo.isCover ? 'ring-2 ring-violet-500' : ''}`}
            />
          </button>
          {photo.isCover && (
            <span className="absolute left-1 top-1 rounded-md bg-violet-600 px-1.5 py-0.5 text-xs font-medium text-white dark:bg-violet-500 dark:text-slate-950">
              Capa
            </span>
          )}
          <ConfirmDeleteForm
            action={async () => { const result = await removeProductPhoto(photo.id); router.refresh(); return result }}
            confirmMessage="Remover esta foto?"
            className="absolute right-1 top-1 rounded-md bg-slate-950/70 px-1.5 py-0.5 text-xs text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
          />
        </div>
      ))}
    </div>
  )
}
