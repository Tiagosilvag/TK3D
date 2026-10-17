import { NextRequest, NextResponse } from 'next/server'
import { getJobOutput } from '@/lib/meshJobs/jobs'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<NextResponse> {
  const { id, kind } = await params
  if (kind !== 'obj' && kind !== 'stl' && kind !== 'glb') {
    return NextResponse.json({ error: 'Formato inválido' }, { status: 400 })
  }
  const data = await getJobOutput(id, kind)
  if (!data) {
    return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 })
  }
  const contentType = kind === 'obj' ? 'model/obj' : kind === 'stl' ? 'model/stl' : 'model/gltf-binary'
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="modelo-${id}.${kind}"`,
    },
  })
}
