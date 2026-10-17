import { NextRequest, NextResponse } from 'next/server'
import { getJobImage, getJobOutput } from '@/lib/meshJobs/jobs'

// 'input' (a imagem original enviada, não um arquivo de saída do
// Hunyuan3D) fica nessa mesma rota pra reaproveitar a autenticação por
// sessão de navegador (já exemptada do bearer do worker em
// middleware.ts) -- usado pela tela pra mostrar a "imagem de
// referência" do job ativo, inclusive depois de recarregar a página.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<NextResponse> {
  const { id, kind } = await params

  if (kind === 'input') {
    const image = await getJobImage(id)
    if (!image) {
      return NextResponse.json({ error: 'Imagem não encontrada' }, { status: 404 })
    }
    return new NextResponse(new Uint8Array(image.data), {
      headers: { 'Content-Type': image.contentType },
    })
  }

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
