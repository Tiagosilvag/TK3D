'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Logo } from '@/components/Logo'

type NavLink = { href: string; label: string }

// Protagonists: the app's core value loop (see what's happening, log a sale,
// manage what you sell), always visible and visually louder than the rest.
const PROTAGONIST_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/sales', label: 'Vendas' },
  { href: '/products', label: 'Produtos' },
]

const SECONDARY_LINKS: NavLink[] = [{ href: '/production', label: 'Produção' }]

const CONSIGNMENT_NAV_LINKS: NavLink[] = [
  { href: '/consignment/partners', label: 'Parceiros' },
  { href: '/consignment/deliveries', label: 'Entregas' },
  { href: '/consignment/reports', label: 'Relatórios de venda' },
]

const SETTINGS_NAV_LINKS: NavLink[] = [
  { href: '/printers', label: 'Impressoras' },
  { href: '/filaments', label: 'Filamentos' },
  { href: '/packaging', label: 'Embalagens' },
  { href: '/accessories', label: 'Acessórios' },
  { href: '/supplies', label: 'Insumos' },
  { href: '/settings/accessory-types', label: 'Tipos de acessório' },
  { href: '/settings', label: 'Configurações' },
]

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function ProtagonistLink({ href, label, active }: NavLink & { active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 font-display text-base font-semibold transition-colors ${
        active
          ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-slate-950'
          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          active ? 'bg-white dark:bg-slate-950' : 'bg-amber-500'
        }`}
        aria-hidden
      />
      {label}
    </Link>
  )
}

function SecondaryLink({ href, label, active, badge }: NavLink & { active: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
      }`}
    >
      {label}
      {!!badge && (
        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
          {badge}
        </span>
      )}
    </Link>
  )
}

export function AppLayoutClient({ children, suppliesOutOfStockCount }: { children: React.ReactNode; suppliesOutOfStockCount: number }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const settingsGroupActive = SETTINGS_NAV_LINKS.some((link) => isActive(pathname, link.href))

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-5 dark:border-slate-800">
          <Logo />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Controle de Produção</p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4 font-display">
          {/* Protagonists */}
          <div className="space-y-1">
            {PROTAGONIST_LINKS.map((link) => (
              <ProtagonistLink key={link.href} {...link} active={isActive(pathname, link.href)} />
            ))}
          </div>

          <div className="my-3 border-t border-slate-200 dark:border-slate-800" />

          {/* Secondary */}
          <div className="space-y-1">
            {SECONDARY_LINKS.map((link) => (
              <SecondaryLink key={link.href} {...link} active={isActive(pathname, link.href)} />
            ))}
          </div>

          <p className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Consignado
          </p>
          <div className="space-y-1">
            {CONSIGNMENT_NAV_LINKS.map((link) => (
              <SecondaryLink key={link.href} {...link} active={isActive(pathname, link.href)} />
            ))}
          </div>

          {/* Configurações: collapsible catalog group, default closed */}
          <details className="mt-4 group" open={settingsGroupActive}>
            <summary
              className={`flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
                settingsGroupActive
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
              }`}
            >
              Configurações
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90"
                aria-hidden
              >
                <path d="M7 5l6 5-6 5V5z" />
              </svg>
            </summary>
            <div className="mt-1 space-y-1">
              {SETTINGS_NAV_LINKS.map((link) => (
                <SecondaryLink
                  key={link.href}
                  {...link}
                  active={isActive(pathname, link.href)}
                  badge={link.href === '/supplies' ? suppliesOutOfStockCount : undefined}
                />
              ))}
            </div>
          </details>
        </nav>

        <div className="flex items-center gap-2 border-t border-slate-200 p-2 dark:border-slate-800">
          <button
            type="button"
            onClick={handleLogout}
            className="flex-1 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            Sair
          </button>
          <ThemeToggle />
        </div>
      </aside>
      <main className="print-bed-bg flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
