// Marca d'água decorativa no canto inferior direito -- pedido explícito
// do usuário. `fixed` (não `absolute`) pra ficar presa à janela mesmo
// rolando uma tela comprida, em vez de rolar junto com o conteúdo ou se
// repetir a cada scroll. `pointer-events-none` + `aria-hidden` porque é
// só decoração -- nunca deve competir com texto/tabela em cima (que
// continuam opacos, ver tk-panel) nem atrapalhar clique/leitor de tela.
// `-z-10` garante que fica atrás do conteúdo normal (que não define
// z-index próprio, então empata acima de qualquer z-index negativo no
// mesmo contexto de empilhamento).
//
// Bug "só aparece uma pontinha no canto / some no tema claro": o
// deslocamento negativo (-bottom-16 -right-16) empurrava a MAIORIA da
// imagem pra fora da janela, sobrando só uma tira. Pedido explícito do
// usuário depois: maior e bem menos transparente -- w-[20rem]/opacity
// 0.05-0.14 ainda lia fraco demais, sobretudo no tema claro (a mesma
// diferença absoluta de cor precisa de opacidade MAIOR contra um fundo
// claro pra dar o mesmo contraste percebido que contra um fundo
// escuro). Tamanho quase dobrado e opacidade bem mais alta nos dois
// temas, maior ainda no claro.
//
// <img> direto em vez de next/image -- ver comentário em components/
// Logo.tsx (bug "logo não aparece em produção": next/image precisa de
// `sharp` em runtime pro build standalone, nem sempre incluído no
// tracing do Docker).
export function LogoWatermark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arquivo estático em public/, sem necessidade de otimização em runtime
    <img
      src="/brand/logo-icon.png"
      alt=""
      aria-hidden="true"
      width={1190}
      height={624}
      className="pointer-events-none fixed bottom-4 right-4 -z-10 h-auto w-[34rem] max-w-[75vw] select-none opacity-[0.35] dark:opacity-[0.18]"
    />
  )
}
