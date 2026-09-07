import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const photo = await prisma.productPhoto.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  })

  if (!photo) {
    return NextResponse.json({ error: 'Foto não encontrada' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(photo.data), {
    headers: {
      'Content-Type': photo.contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
