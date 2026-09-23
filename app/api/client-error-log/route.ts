import { NextRequest, NextResponse } from 'next/server'

// Bug "erro client-side não aparece em lugar nenhum": esse app não tinha
// nenhum error.tsx, então uma exceção só no navegador (hidratação, erro de
// render, promise rejeitada) branqueava a tela inteira sem deixar rastro
// nenhum no log do Coolify (que só captura stdout/stderr do processo
// Node) -- só existia no console do navegador de quem estava com a aba
// aberta na hora, perdido depois de recarregar. Este endpoint recebe o que
// ClientErrorLogger.tsx (captura global) e os error.tsx (boundaries de
// rota) reportam e faz console.error aqui, que O COOLIFY JÁ CAPTURA --
// sem tabela nova, sem serviço externo, só reaproveitando o mesmo
// mecanismo de log que toda a aplicação já usa.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const { message, stack, digest, url, source, userAgent } = body as Record<string, unknown>
  console.error(
    '[client-error]',
    JSON.stringify({
      message: typeof message === 'string' ? message.slice(0, 2000) : String(message),
      digest: typeof digest === 'string' ? digest : undefined,
      source: typeof source === 'string' ? source : 'unknown',
      url: typeof url === 'string' ? url : undefined,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : undefined,
      stack: typeof stack === 'string' ? stack.slice(0, 4000) : undefined,
    }),
  )
  return NextResponse.json({ ok: true })
}
