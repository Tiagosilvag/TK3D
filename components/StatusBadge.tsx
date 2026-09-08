import type { StatusBadge as StatusBadgeShape } from '@/lib/format'

// 5.3: um único lugar pro markup do "pill" de status -- antes cada tela
// (Produção, Pedidos, Vendas, Ficha técnica) montava o mesmo
// `rounded-full px-2 py-0.5...` na mão, com risco de divergir aos poucos.
export function StatusBadge({ badge, title }: { badge: StatusBadgeShape; title?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`} title={title}>
      {badge.label}
    </span>
  )
}
