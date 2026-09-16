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
// Bug "some no tema claro, mesmo depois de aumentar bastante a
// opacidade": tentei opacity-[0.35] dark:opacity-[0.18] (confirmado no
// CSS compilado que a classe gerava a regra certa) e mesmo assim sumia
// só no tema claro -- não achei uma causa estrutural (posição/stacking
// idênticos aos do tema escuro, que sempre funcionou). Pra eliminar de
// vez a variável "opacity + variante dark: em runtime" da equação, a
// transparência agora vem GRAVADA no próprio PNG (logo-watermark.png,
// alpha pré-multiplicado a ~24% via PIL) -- a classe CSS não define
// opacidade nenhuma (fica no opaco padrão, 1), então não há mais
// nenhuma classe/variante que possa falhar em runtime só num tema.
//
// <img> direto em vez de next/image -- ver comentário em components/
// Logo.tsx (bug "logo não aparece em produção": next/image precisa de
// `sharp` em runtime pro build standalone, nem sempre incluído no
// tracing do Docker).
export function LogoWatermark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arquivo estático em public/, sem necessidade de otimização em runtime
    <img
      src="/brand/logo-watermark.png"
      alt=""
      aria-hidden="true"
      width={1190}
      height={624}
      className="pointer-events-none fixed bottom-4 right-4 -z-10 h-auto w-[34rem] max-w-[75vw] select-none"
    />
  )
}
