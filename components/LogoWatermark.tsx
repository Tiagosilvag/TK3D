import Image from 'next/image'

// Marca d'água decorativa no canto inferior direito -- pedido explícito
// do usuário. `fixed` (não `absolute`) pra ficar presa à janela mesmo
// rolando uma tela comprida, em vez de rolar junto com o conteúdo ou se
// repetir a cada scroll. Opacidade bem baixa e `pointer-events-none` +
// `aria-hidden` porque é só decoração -- nunca deve competir com texto/
// tabela em cima (que continuam opacos, ver tk-panel) nem atrapalhar
// clique/leitor de tela. `-z-10` garante que fica atrás do conteúdo
// normal (que não define z-index próprio, então empata acima de
// qualquer z-index negativo no mesmo contexto de empilhamento).
export function LogoWatermark() {
  return (
    <Image
      src="/brand/logo-icon.png"
      alt=""
      aria-hidden="true"
      width={1190}
      height={624}
      priority={false}
      className="pointer-events-none fixed -bottom-16 -right-16 -z-10 h-auto w-[26rem] max-w-[70vw] select-none opacity-[0.05] dark:opacity-[0.07]"
    />
  )
}
