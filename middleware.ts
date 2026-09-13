import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'

export const runtime = 'nodejs'

// Bug "logo quebrada no login": /brand/*.png (e o favicon gerado em
// /icon.png) são arquivos estáticos de public/, mas a tela de Login é
// justamente pra quem ainda NÃO tem sessão -- sem essa isenção, o
// navegador pedia a imagem, o middleware via que não tinha `session`
// válido e redirecionava ESSE PEDIDO (não a navegação da página) pra
// /login, devolvendo HTML no lugar do PNG. O navegador então tentava
// renderizar aquele HTML como imagem e falhava (ícone quebrado).
function isPublicAsset(pathname: string): boolean {
  return pathname.startsWith('/brand/') || pathname === '/icon.png'
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login') || pathname.startsWith('/_next') || isPublicAsset(pathname)) {
    return NextResponse.next()
  }
  const token = req.cookies.get('session')?.value ?? ''
  if (!verifySession(token)) {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
