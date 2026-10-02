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
  let payload: unknown
  try {
    payload = await request.json()
  } catch (err) {
    console.debug('[mercadoLivre] webhook com JSON inválido', { err })
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Validar estrutura do payload: deve ser object, não null, com topic e resource strings
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>).topic !== 'string' ||
    typeof (payload as Record<string, unknown>).resource !== 'string'
  ) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const typedPayload = payload as MLWebhookPayload

  if (typedPayload.topic !== 'orders_v2') {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const orderId = extractOrderId(typedPayload.resource)
  if (!orderId) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    await processOrderNotification(orderId)
  } catch (err) {
    console.error('[mercadoLivre] falha ao processar webhook de pedido', {
      orderId,
      topic: typedPayload.topic,
      resource: typedPayload.resource,
      err,
    })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
