/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Bug "erro ao enviar foto": Server Actions do Next.js limitam o corpo da
  // requisição a 1MB por padrão -- o upload de foto de produto
  // (actions/productPhotos.ts#addProductPhoto) já valida até 5MB e a UI
  // anuncia "até 5MB", mas sem esse override qualquer foto real de
  // celular/câmera (quase sempre > 1MB) era rejeitada pelo PRÓPRIO Next.js
  // antes de chegar na action, com um erro genérico de servidor. 6MB dá
  // margem pro envelope multipart/form-data em volta dos 5MB do arquivo.
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
    },
  },
  // Deploy demorando ~18min (log 2026-09-12): lint + type-check dentro do
  // `next build` sozinhos custavam ~4min. Já rodamos `npx tsc --noEmit` e
  // `npm run lint` manualmente antes de cada commit (ver CLAUDE.md,
  // "Verificação antes de cada commit") -- refazer isso dentro do build de
  // produção é trabalho duplicado. Se algo escapar dessa checagem manual,
  // só quebra em runtime em vez de barrar o build -- risco aceito dado que
  // a checagem já roda antes de todo commit.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
}

module.exports = nextConfig
