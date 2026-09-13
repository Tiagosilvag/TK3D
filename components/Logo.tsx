import Image from 'next/image'

// Proporção real do recorte do ícone (public/brand/logo-icon.png,
// 1190×624) -- usada pra calcular a largura a partir da altura (`size`)
// sem distorcer, já que next/image exige width+height explícitos.
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
 */
export function Logo({ iconOnly = false, size = 32 }: { iconOnly?: boolean; size?: number }) {
  const icon = (
    <Image
      src="/brand/logo-icon.png"
      alt="TK3D"
      width={Math.round(size * ICON_ASPECT)}
      height={size}
      priority
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
