import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { completeJob } from '@/lib/meshJobs/jobs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await params
  const formData = await request.formData()
  const obj = formData.get('obj')
  const stl = formData.get('stl')
  const glb = formData.get('glb')
  if (!(obj instanceof File) || !(stl instanceof File) || !(glb instanceof File)) {
    return NextResponse.json({ error: 'Faltou o arquivo .obj, .stl ou .glb' }, { status: 400 })
  }
  const objBuffer = Buffer.from(await obj.arrayBuffer())
  const stlBuffer = Buffer.from(await stl.arrayBuffer())
  const glbBuffer = Buffer.from(await glb.arrayBuffer())
  await completeJob(id, objBuffer, stlBuffer, glbBuffer)
  return NextResponse.json({ ok: true })
}
