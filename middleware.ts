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

// Finding 1 (revisão final da integração Mercado Livre): webhooks de
// marketplace (POST do ML em /api/webhooks/mercado-livre, e qualquer
// outro que venha a existir em /api/webhooks/*) chegam sem o cookie
// `session` -- são requisições servidor-a-servidor, nunca um navegador
// autenticado. Sem esta isenção, toda entrega virava um 307 pro /login
// e o route handler NUNCA rodava: o webhook ficava inalcançável em
// produção (ML reenviaria e poderia até desativar o tópico), sobrando só
// o poller de 5 minutos pra notar pedidos novos. Prefixo (não o path
// literal do ML) pra cobrir automaticamente um futuro webhook de outra
// plataforma (ex.: Shopee) sem precisar editar o middleware de novo.
function isWebhookPath(pathname: string): boolean {
  return pathname.startsWith('/api/webhooks/')
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login') || pathname.startsWith('/_next') || isPublicAsset(pathname) || isWebhookPath(pathname)) {
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
