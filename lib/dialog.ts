import type { MouseEvent } from 'react'

// Bug "modal fecha ao mexer na quantidade": o padrão "clique fora fecha"
// de todo <dialog> nativo do app comparava `e.target === dialogRef.current`
// -- funciona pro caso comum (clique de verdade no backdrop), mas é frágil
// contra qualquer elemento cujo clique dispare um re-render NO MEIO do
// próprio gesto de clique (mousedown → mouseup), como o spinner nativo de
// <input type="number"> (Quantidade a montar): o navegador incrementa/
// decrementa e dispara `input`/`change` sincronamente ainda durante o
// clique, React re-renderiza, e se o nó que estava sob o cursor deixa de
// existir nesse meio-tempo, o navegador resolve `click.target` pro
// ancestral mais próximo que sobrou -- que pode ser o próprio <dialog>,
// fechando a modal sem o usuário ter clicado fora de verdade.
//
// Fix: checa as COORDENADAS do clique contra o retângulo do próprio
// <dialog> (que não tem padding nele -- ver p-0 em cada modal -- então a
// caixa do elemento bate exatamente com o conteúdo visível) em vez da
// identidade do nó clicado. Imune a qualquer reconciliação de DOM no meio
// do gesto, porque não depende de qual nó "sobrou" no fim do clique.
export function isOutsideDialogClick(e: MouseEvent<HTMLDialogElement>): boolean {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom
}
