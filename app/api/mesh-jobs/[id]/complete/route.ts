import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { saveJobOutputPart } from '@/lib/meshJobs/jobs'

// Recebe UM arquivo de saída por chamada (ver saveJobOutputPart) -- o
// worker chama essa rota 3x (obj, stl, glb) em vez de mandar tudo junto
// num multipart só, que o proxy de produção rejeitava com 413.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await params
  const formData = await request.formData()
  const kind = formData.get('kind')
  const file = formData.get('file')
  if (kind !== 'obj' && kind !== 'stl' && kind !== 'glb') {
    return NextResponse.json({ error: 'kind inválido (use obj, stl ou glb)' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Faltou o arquivo' }, { status: 400 })
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  await saveJobOutputPart(id, kind, buffer)
  return NextResponse.json({ ok: true })
}
