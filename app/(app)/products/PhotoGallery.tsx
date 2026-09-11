'use client'
import { useRouter } from 'next/navigation'
import { removeProductPhoto, setProductCoverPhoto } from '@/actions/productPhotos'
import { ConfirmDeleteForm } from '@/components/ConfirmDeleteForm'

export interface PhotoItem {
  id: string
  isCover: boolean
}

// Melhoria "Produtos" §3: clicar numa foto marca ela como capa (mostrada no
// card da listagem) -- não existe upload separado de "foto de capa", é
// sempre uma das fotos já enviadas abaixo. Sem confirmação (é reversível a
// qualquer momento, só clicar em outra).
export function PhotoGallery({ photos, productName }: { photos: PhotoItem[]; productName: string }) {
  const router = useRouter()

  async function handleSetCover(photoId: string) {
    const result = await setProductCoverPhoto(photoId)
    if (result.success) router.refresh()
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
              className={`aspect-square w-full object-cover ${photo.isCover ? 'ring-2 ring-amber-500' : ''}`}
            />
          </button>
          {photo.isCover && (
            <span className="absolute left-1 top-1 rounded-md bg-amber-600 px-1.5 py-0.5 text-xs font-medium text-white dark:bg-amber-500 dark:text-slate-950">
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
