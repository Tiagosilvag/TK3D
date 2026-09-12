'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Logo } from '@/components/Logo'
import {
  NavDashboardIcon,
  NavOrdersIcon,
  NavSalesIcon,
  NavProductsIcon,
  NavProductionIcon,
  NavAssemblyIcon,
  NavStockIcon,
  NavPartnersIcon,
  NavDeliveriesIcon,
  NavReportsIcon,
  NavPrintersIcon,
  NavFilamentsIcon,
  NavPackagingIcon,
  NavAccessoriesIcon,
  NavSuppliesIcon,
  NavMarketplacesIcon,
  NavSettingsIcon,
  NavUserIcon,
  NavLogoutIcon,
} from '@/components/NavIcons'

type IconComponent = (props: { className?: string }) => React.ReactElement

type NavLink = { href: string; label: string; icon: IconComponent }

// Protagonists: the app's core value loop (see what's happening, log a sale,
// manage what you sell), always visible and visually louder than the rest.
const PROTAGONIST_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Dashboard', icon: NavDashboardIcon },
  { href: '/orders', label: 'Pedidos', icon: NavOrdersIcon },
  { href: '/sales', label: 'Vendas', icon: NavSalesIcon },
  { href: '/products', label: 'Produtos', icon: NavProductsIcon },
]

const PRODUCTION_NAV_LINKS: NavLink[] = [
  { href: '/production', label: 'Produção', icon: NavProductionIcon },
  { href: '/assembly', label: 'Montagem', icon: NavAssemblyIcon },
  { href: '/stock', label: 'Meu Estoque', icon: NavStockIcon },
  // Integração Bambu Lab (spec 2026-09-11): reaproveita NavProductionIcon
  // por ora -- ícone dedicado é ajuste cosmético que não bloqueia a task.
  { href: '/monitor', label: 'Monitoramento', icon: NavProductionIcon },
  { href: '/bambu-history', label: 'Histórico Bambu', icon: NavProductionIcon },
]

const CONSIGNMENT_NAV_LINKS: NavLink[] = [
  { href: '/consignment/partners', label: 'Parceiros', icon: NavPartnersIcon },
  { href: '/consignment/deliveries', label: 'Entregas', icon: NavDeliveriesIcon },
  { href: '/consignment/reports', label: 'Relatórios de venda', icon: NavReportsIcon },
]

// Melhoria "Menu lateral" §4/§5: "Tipos de acessório" não existe mais aqui
// (gestão migrou pro dropdown de Tipo em Acessórios → Novo acessório) e
// "Plataformas de marketplace" vira "Marketplaces", item comum desta lista
// -- sem tela própria (aponta pra dentro de /settings, seção Precificação,
// ver id="marketplaces" em SettingsForm.tsx).
const SETTINGS_NAV_LINKS: NavLink[] = [
  { href: '/printers', label: 'Impressoras', icon: NavPrintersIcon },
  { href: '/filaments', label: 'Filamentos', icon: NavFilamentsIcon },
  { href: '/packaging', label: 'Embalagens', icon: NavPackagingIcon },
  { href: '/accessories', label: 'Acessórios', icon: NavAccessoriesIcon },
  { href: '/supplies', label: 'Insumos', icon: NavSuppliesIcon },
  { href: '/settings#marketplaces', label: 'Marketplaces', icon: NavMarketplacesIcon },
  { href: '/settings', label: 'Configurações', icon: NavSettingsIcon },
]

function isActive(pathname: string, href: string) {
  // Links âncora (ex: "/settings#marketplaces") nunca batem aqui -- o
  // usePathname() do Next não inclui fragmento, e o item "Configurações"
  // logo abaixo já cobre o destaque de "estou em /settings".
  return pathname === href || pathname.startsWith(`${href}/`)
}

function ProtagonistLink({ href, label, icon: Icon, active }: NavLink & { active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 font-display text-base font-semibold transition-colors ${
        active
          ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white dark:from-violet-500 dark:to-fuchsia-500 dark:text-slate-950'
          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {label}
    </Link>
  )
}

// Melhoria "Menu lateral" §3: item ativo ganha preenchimento de cor sólido
// (mesmo tratamento do ProtagonistLink acima), não mais só um fundo âmbar
// pálido quase imperceptível -- muito mais evidente onde a pessoa está.
function SecondaryLink({ href, label, icon: Icon, active, badge }: NavLink & { active: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white dark:from-violet-500 dark:to-fuchsia-500 dark:text-slate-950'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {!!badge && (
        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
          {badge}
        </span>
      )}
    </Link>
  )
}

// Melhoria "Menu lateral" §2: Produção/Consignado/Configurações viram todos
// seções colapsáveis (mesmo <details>/<summary> nativo que Configurações já
// usava) -- abertas por padrão só quando a página atual está dentro delas.
function NavSection({ title, links, pathname, badges }: { title: string; links: NavLink[]; pathname: string; badges?: Record<string, number> }) {
  const sectionActive = links.some((link) => isActive(pathname, link.href))
  return (
    <details className="mt-4 group" open={sectionActive}>
      <summary
        className={`flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
          sectionActive
            ? 'text-violet-700 dark:text-violet-400'
            : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
        }`}
      >
        {title}
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden>
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
      </summary>
      <div className="mt-1 space-y-1">
        {links.map((link) => (
          <SecondaryLink key={link.href} {...link} active={isActive(pathname, link.href)} badge={badges?.[link.href]} />
        ))}
      </div>
    </details>
  )
}

export function AppLayoutClient({
  children,
  suppliesOutOfStockCount,
  filamentsLowStockCount,
}: {
  children: React.ReactNode
  suppliesOutOfStockCount: number
  filamentsLowStockCount: number
}) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const SETTINGS_BADGES: Record<string, number> = { '/supplies': suppliesOutOfStockCount, '/filaments': filamentsLowStockCount }

  return (
    <div className="tk-gradient-bg flex min-h-screen">
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

          <NavSection title="Produção" links={PRODUCTION_NAV_LINKS} pathname={pathname} />
          <NavSection title="Consignado" links={CONSIGNMENT_NAV_LINKS} pathname={pathname} />
          <NavSection title="Configurações" links={SETTINGS_NAV_LINKS} pathname={pathname} badges={SETTINGS_BADGES} />
        </nav>

        {/* Melhoria "Menu lateral" §6: rodapé fixo separado da navegação --
            tema (ícone + rótulo do modo atual + switch) e conta (avatar +
            Sair) agrupados. Sem nome/avatar de usuário de verdade: login
            hoje é senha única compartilhada, sem tabela de usuário (ver
            CLAUDE.md) -- "Administrador" é um rótulo genérico de conta, não
            um nome inventado, e fica pronto pra virar o nome real assim que
            existir multiusuário. */}
        <div className="space-y-1 border-t border-slate-200 p-2 dark:border-slate-800">
          <ThemeToggle />
          <div className="flex items-center gap-2 rounded-lg px-1 py-1">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <NavUserIcon className="h-4 w-4" />
            </span>
            <span className="flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-300">Administrador</span>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sair"
              title="Sair"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <NavLogoutIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="print-bed-bg flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
