import { PrismaClient, FilamentMaterial as MaterialType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })

  // Bug "seed recria impressora excluída": até aqui o seed fixava uma
  // lista de impressoras de EXEMPLO (Bambu Lab A1 Mini, Anycubic Kobra X,
  // etc.) via upsert-por-nome em todo deploy. Isso funciona pra impressora
  // que só foi DESATIVADA (active=false, linha continua existindo, upsert
  // não faz nada) -- mas quem exclui PERMANENTEMENTE uma dessas
  // (deletePrinterPermanently, hard delete de verdade) via tela de
  // Impressoras via a linha ressuscitar no próximo deploy, porque o
  // upsert não encontra mais nada com aquele nome e cria de novo. Mesmo
  // bug já corrigido pra Insumo/Embalagem (ver comentários abaixo) --
  // aplica aqui a mesma solução: impressora real só nasce de um cadastro
  // real (createPrinter, tela /printers), nunca de seed.

  const materialDefaults = [
    { material: MaterialType.PLA, diameterMm: 1.75, densityGCm3: 1.24, nozzleTempC: 210, bedTempC: 60 },
    { material: MaterialType.PETG, diameterMm: 1.75, densityGCm3: 1.27, nozzleTempC: 240, bedTempC: 80 },
    { material: MaterialType.TPU, diameterMm: 1.75, densityGCm3: 1.21, nozzleTempC: 220, bedTempC: 50 },
    { material: MaterialType.OUTRO, diameterMm: 1.75, densityGCm3: 1.24, nozzleTempC: 220, bedTempC: 60 },
  ]
  for (const d of materialDefaults) {
    await prisma.materialDefaults.upsert({ where: { material: d.material }, update: {}, create: d })
  }

  // Melhoria "Embalagens": PackagingItem ganhou controle de estoque real
  // (currentStock/avgUnitCost, cadastro = primeira compra) -- não seeda mais
  // placeholders aqui, mesmo raciocínio do Bug 2 abaixo pra Insumos: um item
  // criado com estoque zero fica esgotado pra sempre e não pode ser
  // removido pela UI. Embalagem real só nasce de um cadastro real
  // (createPackagingItem), nunca de seed. Itens já existentes no banco (de
  // deploys anteriores a essa mudança) não são afetados -- isso só remove a
  // inserção, nunca apaga linha existente.

  // Bug 2: Insumos NUNCA são seedados como placeholders com estoque zero --
  // um Supply criado assim fica esgotado pra sempre (ninguém repõe o que
  // não sabe que existe) e não pode ser removido pela UI (esgotados não
  // podem ser excluídos, spec §1.3), então cada deploy que reseedasse isso
  // reintroduziria lixo permanente no Dashboard. Insumo real só nasce de
  // uma compra real (createSupply), nunca de seed.

  console.log('Seed concluído.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())
