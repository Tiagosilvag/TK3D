import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { getJobImage } from '@/lib/meshJobs/jobs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await params
  const image = await getJobImage(id)
  if (!image) {
    return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 })
  }
  return new NextResponse(new Uint8Array(image.data), {
    headers: { 'Content-Type': image.contentType },
  })
}
