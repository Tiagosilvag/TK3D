import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

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

// Runs before paint (blocking, no src) so the correct theme class is on
// <html> from the very first frame — otherwise a page that loaded in dark
// mode last time would flash light before ThemeToggle's effect ran.
//
// Bug "tema muda sozinho ao decorrer do tempo": enquanto o usuário nunca
// clicava em ThemeToggle, localStorage('theme') ficava vazio pra sempre --
// esse script caía no fallback de matchMedia TODA VEZ que uma página
// nova carregava do zero (nova aba, F5, link direto). Se o SO tem "modo
// escuro automático" agendado por horário (comum em Windows/macOS/
// celular), o resultado do matchMedia muda sozinho durante o dia -- daí
// o app "trocava de tema" ao navegar em momentos diferentes, mesmo sem o
// usuário nunca ter escolhido nada. Agora a 1ª decisão (seja ela do
// localStorage OU do matchMedia) é GRAVADA de volta no localStorage,
// fixando o tema a partir daí -- só muda de novo se o usuário clicar em
// ThemeToggle.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
    if (!stored) localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch (e) {}
})();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={`${spaceGrotesk.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  )
}
