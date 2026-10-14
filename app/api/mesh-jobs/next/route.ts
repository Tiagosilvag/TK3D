import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/meshJobs/auth'
import { claimNextJob } from '@/lib/meshJobs/jobs'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const job = await claimNextJob()
  if (!job) {
    return new NextResponse(null, { status: 204 })
  }
  return NextResponse.json({ id: job.id })
}
