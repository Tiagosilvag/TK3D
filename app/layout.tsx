import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { ClientErrorLogger } from '@/components/ClientErrorLogger'

// Bug "deploy falha por causa de fonte": next/font/google baixa a fonte do
// Google Fonts DURANTE o build (dentro do container Docker) -- se a rede do
// servidor tiver qualquer instabilidade nesse momento (ex.: mesmo evento que
// derrubou o Coolify em 2026-09-12), o build inteiro falha com
// "NextFontError: Failed to fetch ... ETIMEDOUT", sem nenhuma relação com o
// código da aplicação. Os arquivos .woff2 abaixo são os MESMOS que o Google
// Fonts serve (variable font, cobre os pesos 400-600/500-700 usados aqui) --
// só que vendorizados no repo, então o build nunca mais depende de acesso à
// internet.
const spaceGrotesk = localFont({
  src: './fonts/SpaceGrotesk-Variable.woff2',
  weight: '500 700',
  variable: '--font-display',
  display: 'swap',
})

const inter = localFont({
  src: './fonts/Inter-Variable.woff2',
  weight: '400 600',
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'TK3D - Controle de Produção',
  description: 'Sistema de controle de produção para impressão 3D',
}

// Pedido "deixe somente no tema escuro": app sempre em dark, sem opção de
// alternar -- ThemeToggle/localStorage('theme')/matchMedia removidos (não
// tem mais o que decidir em runtime, `dark` fica fixo na classe do <html>).
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={`dark ${spaceGrotesk.variable} ${inter.variable}`}>
      <body className="font-sans">
        <ClientErrorLogger />
        {children}
      </body>
    </html>
  )
}
