import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/mercadoLivre/auth'
import { saveConnection } from '@/lib/mercadoLivre/connection'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code')
  const redirectBase = new URL('/settings/integrations', request.url)

  if (!code) {
    redirectBase.searchParams.set('erro', 'Autorização do Mercado Livre cancelada ou sem código')
    return NextResponse.redirect(redirectBase)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    await saveConnection(tokens)
    redirectBase.searchParams.set('conectado', '1')
  } catch (err) {
    redirectBase.searchParams.set('erro', err instanceof Error ? err.message : 'Falha ao conectar com o Mercado Livre')
  }
  return NextResponse.redirect(redirectBase)
}
