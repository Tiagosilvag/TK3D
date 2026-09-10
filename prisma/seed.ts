import { PrismaClient, FilamentMaterial as MaterialType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })

  // energyCostPerKwh/maintenanceCostPerHour (melhoria "Impressoras"): antes
  // vinham de Settings.energyCostPerKwh/annualMaintenancePercent/
  // annualUsageHours (globais) -- viraram input por impressora, então o
  // seed passa a fixar os mesmos valores que essas máquinas já tinham sob
  // a fórmula antiga (Settings default: tarifa 1.00 R$/kWh, 10% ao ano /
  // 2000h de uso), pra não regredir o custo total de nenhuma delas.
  // nickname fica de fora -- é o apelido que o usuário dá pra própria
  // impressora física, não um dado de referência pra inventar aqui.
  const printers = [
    { name: 'Bambu Lab A1 Mini', purchasePrice: 3000, depreciationHours: 10000, avgPowerConsumptionKwh: 0.15, energyCostPerKwh: 1.0, maintenanceCostPerHour: 0.15 },
    { name: 'Anycubic Kobra X', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27, energyCostPerKwh: 1.0, maintenanceCostPerHour: 0.18 },
    { name: 'Bambulab A1', purchasePrice: 4800, depreciationHours: 10000, avgPowerConsumptionKwh: 0.15, energyCostPerKwh: 1.0, maintenanceCostPerHour: 0.24, active: false },
    { name: 'Snapmaker U1', purchasePrice: 15000, depreciationHours: 25000, avgPowerConsumptionKwh: 0.3, energyCostPerKwh: 1.0, maintenanceCostPerHour: 0.75, active: false },
    { name: 'Anycubic Kobra S1', purchasePrice: 6000, depreciationHours: 10000, avgPowerConsumptionKwh: 0.35, energyCostPerKwh: 1.0, maintenanceCostPerHour: 0.30, active: false },
  ]
  for (const p of printers) {
    await prisma.printer.upsert({ where: { name: p.name }, update: {}, create: p as any })
  }

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
