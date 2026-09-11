'use server'

import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export async function addProductPhoto(formData: FormData) {
  const productId = formData.get('productId')
  const file = formData.get('file')

  if (typeof productId !== 'string' || !productId) {
    return { success: false, error: 'Produto inválido' }
  }
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: 'Selecione uma foto' }
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return { success: false, error: 'Formato não suportado (use JPEG, PNG, WEBP ou GIF)' }
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { success: false, error: 'Foto muito grande (máximo 5MB)' }
  }

  const data = Buffer.from(await file.arrayBuffer())

  await prisma.productPhoto.create({
    data: {
      productId,
      data,
      contentType: file.type,
      sizeBytes: file.size,
    },
  })

  revalidatePath(`/products/${productId}`)
  return { success: true }
}

export async function removeProductPhoto(photoId: string) {
  const photo = await prisma.productPhoto.delete({ where: { id: photoId } })
  revalidatePath(`/products/${photo.productId}`)
  revalidatePath('/products')
  return { success: true }
}

// Melhoria "Produtos" §3: clicar numa foto já enviada marca ela como capa
// (mostrada no card da listagem) -- desmarca a anterior e marca a nova na
// mesma transação, garantindo no máximo 1 capa por produto (reforçado
// também por um índice único parcial no banco, ver migration.sql).
export async function setProductCoverPhoto(photoId: string) {
  const photo = await prisma.productPhoto.findUniqueOrThrow({ where: { id: photoId } })
  await prisma.$transaction([
    prisma.productPhoto.updateMany({ where: { productId: photo.productId, isCover: true }, data: { isCover: false } }),
    prisma.productPhoto.update({ where: { id: photoId }, data: { isCover: true } }),
  ])
  revalidatePath(`/products/${photo.productId}`)
  revalidatePath('/products')
  return { success: true }
}
