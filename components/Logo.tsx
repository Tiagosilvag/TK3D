// Proporções reais dos recortes (public/brand/), usadas pra calcular
// largura a partir da altura sem distorcer -- next/image não é usado
// aqui (ver comentário abaixo), mas o cálculo continua necessário pra
// não esticar o <img>.
const ICON_ASPECT = 1190 / 624 // logo-icon.png
const WORDMARK_ASPECT = 1164 / 245 // logo-wordmark.png

/**
 * TK3D mark: logo de verdade (fornecida pelo usuário, não mais desenhada/
 * escrita em CSS) -- o ícone é o monograma "TK" (bocal de impressora +
 * fio de filamento embutidos nas letras) e o wordmark é o "TK3D" por
 * extenso na mesma arte, os dois recortados a partir da peça completa em
 * public/brand/logo-full.png (ver docs do commit). `iconOnly` renderiza
 * só o ícone (usado em espaços apertados); senão o lockup completo com
 * o wordmark ao lado -- nunca mais texto CSS, pra bater exatamente com a
 * tipografia/degradê da arte fornecida.
 *
 * Bug "logo não aparece em produção" (ícone quebrado): next/image
 * precisa do pacote `sharp` pra otimizar em runtime -- ele é opcional
 * (não está em package.json, só puxado como optionalDependency do
 * próprio `next`) e o tracing do build `standalone` nem sempre inclui
 * esse require condicional no node_modules copiado pro container final,
 * então o endpoint /_next/image falhava. É um arquivo estático pronto
 * em public/ -- não precisa de nenhuma otimização em runtime, só <img>
 * direto (mesmo padrão já usado em PhotoGallery.tsx).
 */
export function Logo({ iconOnly = false, size = 40 }: { iconOnly?: boolean; size?: number }) {
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

  // Wordmark um pouco mais baixo que o ícone (proporção real da arte é
  // ainda mais achatada -- 245/624 do ícone -- mas isso lia fino demais
  // ao lado do ícone num cabeçalho; 55% mantém legível sem destoar do
  // resto da lockup). Pedido explícito do usuário: um pouco menor e mais
  // perto do ícone do que estava (era 62% + gap-2).
  const wordmarkHeight = Math.round(size * 0.55)
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {/* eslint-disable-next-line @next/next/no-img-element -- arquivo estático em public/, sem necessidade de otimização em runtime */}
      <img
        src="/brand/logo-wordmark.png"
        alt="TK3D"
        width={Math.round(wordmarkHeight * WORDMARK_ASPECT)}
        height={wordmarkHeight}
        className="shrink-0"
      />
    </span>
  )
}
