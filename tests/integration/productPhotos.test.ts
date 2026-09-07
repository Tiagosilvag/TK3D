import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { addProductPhoto, removeProductPhoto } from '@/actions/productPhotos'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

async function cleanup() {
  await prisma.productPhoto.deleteMany()
  await prisma.product.deleteMany()
  await prisma.printer.deleteMany()
  await prisma.filament.deleteMany()
}

beforeAll(async () => {
  await prisma.$connect()
})
beforeEach(cleanup)
afterAll(cleanup)
afterAll(async () => {
  await prisma.$disconnect()
})

async function createTestProduct() {
  const printer = await prisma.printer.create({
    data: { name: 'Foto Printer', purchasePrice: 1000, depreciationHours: 1000, avgPowerConsumptionKwh: 0.1 },
  })
  const filament = await prisma.filament.create({
    data: { manufacturer: 'Foto Filament', diameterMm: 1.75, spoolPrice: 100, spoolWeightKg: 1, densityGCm3: 1.24, nozzleTempC: 200, bedTempC: 60 },
  })
  return prisma.product.create({
    data: { name: 'Chaveiro Foto', printerId: printer.id, filamentId: filament.id, weightGrams: 10, printTimeHours: 1, laborTimeHours: 0 },
  })
}

function fd(productId: string, file: File): FormData {
  const f = new FormData()
  f.append('productId', productId)
  f.append('file', file)
  return f
}

describe('productPhotos actions', () => {
  it('adiciona e depois remove uma foto válida', async () => {
    const product = await createTestProduct()
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'peca.png', { type: 'image/png' })

    const result = await addProductPhoto(fd(product.id, file))
    expect(result.success).toBe(true)

    const photo = await prisma.productPhoto.findFirstOrThrow({ where: { productId: product.id } })
    expect(photo.contentType).toBe('image/png')
    expect(photo.sizeBytes).toBe(4)
    expect(Buffer.from(photo.data).equals(Buffer.from([1, 2, 3, 4]))).toBe(true)

    const removed = await removeProductPhoto(photo.id)
    expect(removed.success).toBe(true)
    const gone = await prisma.productPhoto.findUnique({ where: { id: photo.id } })
    expect(gone).toBeNull()
  })

  it('rejeita tipo de arquivo não suportado', async () => {
    const product = await createTestProduct()
    const file = new File([new Uint8Array([1, 2, 3])], 'peca.txt', { type: 'text/plain' })

    const result = await addProductPhoto(fd(product.id, file))
    expect(result.success).toBe(false)
    const count = await prisma.productPhoto.count()
    expect(count).toBe(0)
  })

  it('rejeita arquivo maior que 5MB', async () => {
    const product = await createTestProduct()
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    const file = new File([big], 'peca-grande.png', { type: 'image/png' })

    const result = await addProductPhoto(fd(product.id, file))
    expect(result.success).toBe(false)
    const count = await prisma.productPhoto.count()
    expect(count).toBe(0)
  })

  it('cascateia a remoção das fotos quando o produto é removido', async () => {
    const product = await createTestProduct()
    const file = new File([new Uint8Array([9, 9])], 'peca.png', { type: 'image/png' })
    await addProductPhoto(fd(product.id, file))

    await prisma.product.delete({ where: { id: product.id } })
    const count = await prisma.productPhoto.count()
    expect(count).toBe(0)
  })
})
