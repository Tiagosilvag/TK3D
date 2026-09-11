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
}

module.exports = nextConfig
