/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Bug "erro ao enviar foto": Server Actions do Next.js limitam o corpo da
  // requisição a 1MB por padrão -- o upload de foto de produto
  // (actions/productPhotos.ts#addProductPhoto) já valida até 5MB e a UI
  // anuncia "até 5MB", mas sem esse override qualquer foto real de
  // celular/câmera (quase sempre > 1MB) era rejeitada pelo PRÓPRIO Next.js
  // antes de chegar na action, com um erro genérico de servidor.
  // Segunda rodada do mesmo bug ("client-side exception" ao enviar foto):
  // 6MB dava margem só pro envelope multipart em torno de um arquivo de
  // EXATAMENTE 5MB -- mas fotos de câmera de celular reais passam disso
  // com frequência (6, 8, 10MB+, resolução alta). Quando o arquivo cru já
  // ultrapassa o limite do Next.js, a rejeição acontece ANTES de
  // addProductPhoto rodar sua própria validação de 5MB, então a mensagem
  // amigável "Foto muito grande (máximo 5MB)" nunca aparece -- o
  // framework derruba a requisição com um erro genérico, que o cliente
  // mostra como tela em branco. 15MB dá bastante margem pra QUALQUER foto
  // real chegar até a validação da action, que segue sendo quem aplica a
  // regra de negócio de 5MB de verdade (com mensagem clara).
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
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
