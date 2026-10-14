import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { failJob } from '@/lib/meshJobs/jobs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const rawMessage = (body as Record<string, unknown> | null)?.message
  const message = typeof rawMessage === 'string' && rawMessage ? rawMessage : 'Falha desconhecida'
  await failJob(id, message)
  return NextResponse.json({ ok: true })
}
