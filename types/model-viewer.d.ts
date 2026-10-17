// Tipagem mínima do web component <model-viewer> (carregado via CDN em
// MeshJobsExplorer.tsx, não é dependência npm -- ver nota "zero libs
// novas" em CLAUDE.md). Só os atributos realmente usados.
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// React 19 move o namespace JSX pra dentro do módulo "react" (não mais
// `declare global { namespace JSX }` como no React <=18) -- por isso a
// augmentation precisa ser feita em cima do módulo, senão não casa com
// o JSX.IntrinsicElements que o compilador realmente resolve.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        alt?: string
        'camera-controls'?: boolean
        'auto-rotate'?: boolean
        'shadow-intensity'?: string
      }
    }
  }
}
