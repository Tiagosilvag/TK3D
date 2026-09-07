import { PrismaClient, AccessoryType, SupplyUnit, FilamentMaterial as MaterialType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })

  const printers = [
    { name: 'Bambu Lab A1 Mini', purchasePrice: 3000, depreciationHours: 10000, avgPowerConsumptionKwh: 0.15 },
    { name: 'Anycubic Kobra X', purchasePrice: 3600, depreciationHours: 10000, avgPowerConsumptionKwh: 0.27 },
    { name: 'Bambulab A1', purchasePrice: 4800, depreciationHours: 10000, avgPowerConsumptionKwh: 0.15, active: false },
    { name: 'Snapmaker U1', purchasePrice: 15000, depreciationHours: 25000, avgPowerConsumptionKwh: 0.3, active: false },
    { name: 'Anycubic Kobra S1', purchasePrice: 6000, depreciationHours: 10000, avgPowerConsumptionKwh: 0.35, active: false },
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

  const packaging = [
    { name: 'Caixa Grande', unitCost: 3.1656 },
    { name: 'Caixa Pequena', unitCost: 1.398 },
    { name: 'Almofada Colmeia', unitCost: 0.8517 },
    { name: 'Fita gomada', unitCost: 0.1933 },
    { name: 'Etiqueta', unitCost: 0.1333 },
  ]
  for (const p of packaging) {
    await prisma.packagingItem.upsert({ where: { name: p.name }, update: {}, create: p })
  }

  const supplies = [
    { name: 'Caneta acrílica', unit: SupplyUnit.UN, unitCost: 0 },
    { name: 'Spray verniz', unit: SupplyUnit.ML, unitCost: 0 },
    { name: 'Resina UV', unit: SupplyUnit.ML, unitCost: 0 },
    { name: 'Cola Tekbond 200', unit: SupplyUnit.ML, unitCost: 0 },
  ]
  for (const s of supplies) {
    await prisma.supply.upsert({ where: { name: s.name }, update: {}, create: s })
  }

  console.log('Seed concluído.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())
