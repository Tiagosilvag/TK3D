'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV_LINKS: { href: string; label: string }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/printers', label: 'Impressoras' },
  { href: '/filaments', label: 'Filamentos' },
  { href: '/packaging', label: 'Embalagens' },
  { href: '/accessories', label: 'Acessórios' },
  { href: '/supplies', label: 'Insumos' },
  { href: '/products', label: 'Produtos' },
  { href: '/settings', label: 'Configurações' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-5">
          <h1 className="text-sm font-semibold text-slate-900">Controle de Produção 3D</h1>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-slate-200 p-2">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
