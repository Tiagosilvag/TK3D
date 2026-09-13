// Proporção real do recorte do ícone (public/brand/logo-icon.png,
// 1190×624) -- usada pra calcular a largura a partir da altura (`size`)
// sem distorcer.
const ICON_ASPECT = 1190 / 624

/**
 * TK3D mark: logo de verdade (fornecida pelo usuário, não mais desenhada
 * em SVG) -- o ícone é um recorte só do monograma "TK" (o bocal de
 * impressora + fio de filamento embutidos nas letras), extraído da peça
 * completa em public/brand/logo-icon.png; a peça completa (ícone + "TK3D"
 * por extenso empilhados) fica em logo-full.png, usada só como fonte pros
 * recortes (ver docs do commit), não referenciada diretamente na UI.
 * `iconOnly` renderiza só o ícone (usado em espaços apertados); senão o
 * lockup completo com "TK3D" ao lado.
 *
 * Bug "logo não aparece em produção" (ícone quebrado): next/image precisa
 * do pacote `sharp` pra otimizar em runtime -- ele é opcional (não está
 * em package.json, só puxado como optionalDependency do próprio `next`)
 * e o tracing do build `standalone` nem sempre inclui esse require
 * condicional no node_modules copiado pro container final, então o
 * endpoint /_next/image falhava (ícone quebrado). É um arquivo estático
 * pronto em public/ -- não precisa de nenhuma otimização em runtime, só
 * <img> direto (mesmo padrão já usado em PhotoGallery.tsx).
 */
export function Logo({ iconOnly = false, size = 32 }: { iconOnly?: boolean; size?: number }) {
  const icon = (
    // eslint-disable-next-line @next/next/no-img-element -- arquivo estático em public/, sem necessidade de otimização em runtime (ver comentário acima)
    <img
      src="/brand/logo-icon.png"
      alt="TK3D"
      width={Math.round(size * ICON_ASPECT)}
      height={size}
      className="shrink-0"
    />
  )

  if (iconOnly) return icon

  return (
    <span className="inline-flex items-center gap-2">
      {icon}
      <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
        TK<span className="text-violet-600 dark:text-violet-500">3D</span>
      </span>
    </span>
  )
}
