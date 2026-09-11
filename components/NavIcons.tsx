// Melhoria "Menu lateral" §1: um ícone por item de navegação (antes só os 4
// itens de topo tinham uma bolinha, o resto era só texto). Ícones em linha
// (stroke, sem preenchimento) pra combinar com o estilo já usado no
// chevron/ThemeToggle deste app -- sem lib nova (zero dependências, mesmo
// espírito do resto do projeto), viewBox 20x20 consistente em todos.
// Exceção: NavProductionIcon reaproveita o motivo de barras empilhadas do
// próprio logo (components/Logo.tsx), preenchido -- é a mesma metáfora
// visual ("camadas de impressão") só que como ícone de navegação.

const common = { viewBox: '0 0 20 20', 'aria-hidden': true } as const

export function NavDashboardIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1.2" />
      <rect x="11" y="3" width="6" height="6" rx="1.2" />
      <rect x="3" y="11" width="6" height="6" rx="1.2" />
      <rect x="11" y="11" width="6" height="6" rx="1.2" />
    </svg>
  )
}

export function NavOrdersIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="4" width="10" height="14" rx="1.4" />
      <rect x="8" y="2.5" width="4" height="3" rx="1" />
      <line x1="7.5" y1="10" x2="12.5" y2="10" />
      <line x1="7.5" y1="13" x2="12.5" y2="13" />
    </svg>
  )
}

export function NavSalesIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h2l1.5 9h8l1.5-6H6.5" />
      <circle cx="8" cy="16.3" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="16.3" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function NavProductsIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3l6 3.2v7.6l-6 3.2-6-3.2V6.2L10 3z" />
      <path d="M4 6.2l6 3.2 6-3.2M10 9.4v7.6" />
    </svg>
  )
}

export function NavProductionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} fill="currentColor">
      <rect x="3.5" y="14.5" width="13" height="2.2" rx="0.9" />
      <rect x="5.3" y="10.7" width="9.4" height="2.2" rx="0.9" opacity="0.85" />
      <rect x="7.1" y="6.9" width="5.8" height="2.2" rx="0.9" opacity="0.7" />
      <rect x="8.9" y="3.1" width="2.2" height="2.2" rx="0.9" opacity="0.55" />
    </svg>
  )
}

export function NavAssemblyIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="9" height="9" rx="1.4" />
      <rect x="8" y="3" width="9" height="9" rx="1.4" />
    </svg>
  )
}

export function NavStockIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6l1.5-2.5h11L17 6" />
      <rect x="3" y="6" width="14" height="10" rx="1.2" />
      <line x1="8" y1="10" x2="12" y2="10" />
    </svg>
  )
}

export function NavPartnersIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="2.3" />
      <path d="M3 16c0-2.5 1.8-4.3 4-4.3s4 1.8 4 4.3" />
      <circle cx="14.5" cy="7.5" r="1.8" />
      <path d="M12.7 12c1.7.4 2.9 1.9 3.3 4" />
    </svg>
  )
}

export function NavDeliveriesIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="7" width="9" height="7" rx="1" />
      <path d="M11.5 9.5h3l2.5 2.5v2h-2" />
      <circle cx="6" cy="15.5" r="1.3" />
      <circle cx="14" cy="15.5" r="1.3" />
    </svg>
  )
}

export function NavReportsIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2.5" width="12" height="15" rx="1.2" />
      <path d="M7 13v-2.5M10 13V8M13 13V9" />
    </svg>
  )
}

export function NavPrintersIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="7" width="10" height="6" rx="1" />
      <path d="M6.5 7V3.5h7V7" />
      <rect x="7" y="12.5" width="6" height="4" rx="0.6" />
    </svg>
  )
}

export function NavFilamentsIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="6.8" />
      <circle cx="10" cy="10" r="2.4" />
    </svg>
  )
}

export function NavPackagingIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="6.5" width="13" height="10" rx="1" />
      <line x1="10" y1="6.5" x2="10" y2="16.5" />
      <path d="M7.2 6.5c0-2 1.2-3 2.8-3s2.8 1 2.8 3" />
    </svg>
  )
}

export function NavAccessoriesIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M10 3l5.5 5.5L10 17 4.5 8.5 10 3z" />
      <path d="M4.5 8.5h11M7.5 3.3l-1 5.2M12.5 3.3l1 5.2" strokeLinecap="round" />
    </svg>
  )
}

export function NavSuppliesIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 3h3M9 3v5.4l-4.2 7.3a1.1 1.1 0 00.95 1.6h8.5a1.1 1.1 0 00.95-1.6L11 8.4V3" />
      <line x1="7.3" y1="12" x2="12.7" y2="12" />
    </svg>
  )
}

export function NavMarketplacesIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5V16a1 1 0 001 1h11a1 1 0 001-1V8.5" />
      <path d="M3 5.5l1-2.5h12l1 2.5" />
      <path d="M3 8.5a2 2 0 004 0 2 2 0 004 0 2 2 0 004 0 2 2 0 004 0" />
    </svg>
  )
}

// Gerada por loop (8 dentes ao redor de um círculo central) em vez de um
// path complexo escrito à mão -- garante uma engrenagem simétrica sem risco
// de um path malformado.
export function NavSettingsIcon({ className }: { className?: string }) {
  const teeth = Array.from({ length: 8 }, (_, i) => i * 45)
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="10" cy="10" r="3.2" />
      {teeth.map((deg) => (
        <line key={deg} x1="10" y1="3" x2="10" y2="5" transform={`rotate(${deg} 10 10)`} />
      ))}
    </svg>
  )
}

export function NavThemeSunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M10 2.5a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2.5zm0 12.25a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM17.5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5a.75.75 0 01.75.75zM4.75 10a.75.75 0 01-.75.75H2.5a.75.75 0 010-1.5H4a.75.75 0 01.75.75zM15.66 4.34a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zM6.46 13.54a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zM15.66 15.66a.75.75 0 01-1.06 0l-1.06-1.06a.75.75 0 111.06-1.06l1.06 1.06a.75.75 0 010 1.06zM6.46 6.46a.75.75 0 01-1.06 0L4.34 5.4a.75.75 0 111.06-1.06l1.06 1.06a.75.75 0 010 1.06zM10 6a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  )
}

export function NavThemeMoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  )
}

export function NavUserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M10 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3.5 18a6.5 6.5 0 0113 0 .75.75 0 01-.75.75h-11.5A.75.75 0 013.5 18z" />
    </svg>
  )
}

export function NavLogoutIcon({ className }: { className?: string }) {
  return (
    <svg {...common} className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 3.5H5a1.5 1.5 0 00-1.5 1.5v10A1.5 1.5 0 005 16.5h2.5" />
      <path d="M13 13.5l4-3.5-4-3.5M17 10H8" />
    </svg>
  )
}
