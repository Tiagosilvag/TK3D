import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TK3D - Controle de Produção',
  description: 'Sistema de controle de produção para impressão 3D',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
