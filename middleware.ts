import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/auth'

export const runtime = 'nodejs'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login') || pathname.startsWith('/_next')) {
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
