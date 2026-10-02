import { NextRequest, NextResponse } from 'next/server'
import { processOrderNotification } from '@/lib/mercadoLivre/orders'

interface MLWebhookPayload {
  topic: string
  resource: string
}

function extractOrderId(resource: string): string | null {
  const match = resource.match(/\/orders\/(\d+)/)
  return match ? match[1] : null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: MLWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  if (payload.topic !== 'orders_v2') {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const orderId = extractOrderId(payload.resource ?? '')
  if (!orderId) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    await processOrderNotification(orderId)
  } catch (err) {
    console.error('[mercadoLivre] falha ao processar webhook de pedido:', err)
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
