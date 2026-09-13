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
// imagem pra fora da janela, sobrando só uma tira -- e opacity-[0.05]
// é baixo demais pra ler contra um fundo claro (funciona melhor sobre
// escuro, onde a MESMA diferença absoluta de cor fica mais perceptível).
// Agora fica inteira dentro da tela (bottom-6 right-6, sem recorte) e
// com opacidade maior no claro que no escuro (inverso de antes).
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
      className="pointer-events-none fixed bottom-6 right-6 -z-10 h-auto w-[20rem] max-w-[55vw] select-none opacity-[0.14] dark:opacity-[0.09]"
    />
  )
}
