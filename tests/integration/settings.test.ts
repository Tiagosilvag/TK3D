import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { updateSettings } from '@/actions/settings'

const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL })

beforeAll(async () => {
  await prisma.$connect()
})
afterAll(async () => {
  await prisma.$disconnect()
})

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

// Configurações §3 fields common to every full-form submission below. Kept
// separate so each test can override just the piece it's exercising.
const baseCompositionAndRounding = {
  desiredMarginPercent: '0.30',
  defaultDiscountPercent: '0',
  stockLowThresholdPercent: '0.30',
  stockCriticalThresholdPercent: '0.10',
  includeDepreciation: 'true',
  includeEnergyCost: 'true',
  includeMaintenance: 'true',
  includeLaborCost: 'true',
  includeFailureRate: 'true',
  includeFilamentCost: 'true',
  includeAccessoriesCost: 'true',
  includeSuppliesCost: 'true',
  includePackagingCost: 'true',
  roundingMode: 'NONE',
}

describe('settings actions', () => {
  it('atualiza (upsert) as configurações e persiste os valores', async () => {
    const result = await updateSettings(fd({
      energyCostPerKwh: '0.95',
      laborCostPerHour: '15',
      failureRatePercent: '0.12',
      marketplaceFeePercent: '0.18',
      taxPercent: '0.06',
      marketplaceFixedFee: '5',
      defaultMarkup: '2.5',
      annualMaintenancePercent: '0.08',
      annualUsageHours: '1800',
      ...baseCompositionAndRounding,
    }))
    expect(result.success).toBe(true)

    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(settings.energyCostPerKwh.toNumber()).toBeCloseTo(0.95)
    expect(settings.laborCostPerHour.toNumber()).toBeCloseTo(15)
    expect(settings.failureRatePercent.toNumber()).toBeCloseTo(0.12)
    expect(settings.marketplaceFeePercent.toNumber()).toBeCloseTo(0.18)
    expect(settings.taxPercent.toNumber()).toBeCloseTo(0.06)
    expect(settings.marketplaceFixedFee.toNumber()).toBeCloseTo(5)
    expect(settings.defaultMarkup.toNumber()).toBeCloseTo(2.5)
    expect(settings.annualMaintenancePercent.toNumber()).toBeCloseTo(0.08)
    expect(settings.annualUsageHours.toNumber()).toBeCloseTo(1800)
    expect(settings.desiredMarginPercent.toNumber()).toBeCloseTo(0.30)
    expect(settings.defaultDiscountPercent.toNumber()).toBeCloseTo(0)
    expect(settings.stockLowThresholdPercent.toNumber()).toBeCloseTo(0.30)
    expect(settings.stockCriticalThresholdPercent.toNumber()).toBeCloseTo(0.10)
    expect(settings.includeDepreciation).toBe(true)
    expect(settings.includeEnergyCost).toBe(true)
    expect(settings.includeMaintenance).toBe(true)
    expect(settings.includeLaborCost).toBe(true)
    expect(settings.includeFailureRate).toBe(true)
    expect(settings.includeFilamentCost).toBe(true)
    expect(settings.includeAccessoriesCost).toBe(true)
    expect(settings.includeSuppliesCost).toBe(true)
    expect(settings.includePackagingCost).toBe(true)
    expect(settings.roundingMode).toBe('NONE')
  })

  it('rejeita failureRatePercent fora do intervalo 0-1', async () => {
    const result = await updateSettings(fd({
      energyCostPerKwh: '0.95',
      laborCostPerHour: '15',
      failureRatePercent: '1.5',
      marketplaceFeePercent: '0.18',
      taxPercent: '0.06',
      marketplaceFixedFee: '5',
      defaultMarkup: '2.5',
      annualMaintenancePercent: '0.08',
      annualUsageHours: '1800',
      ...baseCompositionAndRounding,
    }))
    expect(result.success).toBe(false)
  })

  it('atualiza novamente (upsert idempotente sobre o singleton)', async () => {
    const first = await updateSettings(fd({
      energyCostPerKwh: '1',
      laborCostPerHour: '10',
      failureRatePercent: '0.1',
      marketplaceFeePercent: '0.2',
      taxPercent: '0.055',
      marketplaceFixedFee: '4',
      defaultMarkup: '2',
      annualMaintenancePercent: '0.10',
      annualUsageHours: '2000',
      ...baseCompositionAndRounding,
    }))
    expect(first.success).toBe(true)

    const second = await updateSettings(fd({
      energyCostPerKwh: '1.2',
      laborCostPerHour: '12',
      failureRatePercent: '0.1',
      marketplaceFeePercent: '0.2',
      taxPercent: '0.055',
      marketplaceFixedFee: '4',
      defaultMarkup: '2',
      annualMaintenancePercent: '0.10',
      annualUsageHours: '2000',
      ...baseCompositionAndRounding,
    }))
    expect(second.success).toBe(true)

    const count = await prisma.settings.count()
    expect(count).toBe(1)
    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(settings.energyCostPerKwh.toNumber()).toBeCloseTo(1.2)
  })

  it('desliga flags include* individualmente (checkbox ausente = false, mesma convenção de usesGlue)', async () => {
    const result = await updateSettings(fd({
      energyCostPerKwh: '1',
      laborCostPerHour: '10',
      failureRatePercent: '0.1',
      marketplaceFeePercent: '0.2',
      taxPercent: '0.055',
      marketplaceFixedFee: '4',
      defaultMarkup: '2',
      annualMaintenancePercent: '0.10',
      annualUsageHours: '2000',
      ...baseCompositionAndRounding,
      // Simulates two unchecked checkboxes: simply omitted from the FormData.
      includeAccessoriesCost: '',
      roundingMode: 'R90',
    }))
    expect(result.success).toBe(true)

    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(settings.includeAccessoriesCost).toBe(false)
    expect(settings.includeDepreciation).toBe(true)
    expect(settings.roundingMode).toBe('R90')
  })

  it('rejeita roundingMode inválido', async () => {
    const result = await updateSettings(fd({
      energyCostPerKwh: '1',
      laborCostPerHour: '10',
      failureRatePercent: '0.1',
      marketplaceFeePercent: '0.2',
      taxPercent: '0.055',
      marketplaceFixedFee: '4',
      defaultMarkup: '2',
      annualMaintenancePercent: '0.10',
      annualUsageHours: '2000',
      ...baseCompositionAndRounding,
      roundingMode: 'INVALIDO',
    }))
    expect(result.success).toBe(false)
  })

  it('roundingMode=CUSTOM com roundingCustomCents persiste os dois dígitos finais', async () => {
    const result = await updateSettings(fd({
      energyCostPerKwh: '1',
      laborCostPerHour: '10',
      failureRatePercent: '0.1',
      marketplaceFeePercent: '0.2',
      taxPercent: '0.055',
      marketplaceFixedFee: '4',
      defaultMarkup: '2',
      annualMaintenancePercent: '0.10',
      annualUsageHours: '2000',
      ...baseCompositionAndRounding,
      roundingMode: 'CUSTOM',
      roundingCustomCents: '50',
    }))
    expect(result.success).toBe(true)

    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(settings.roundingMode).toBe('CUSTOM')
    expect(settings.roundingCustomCents).toBe(50)
  })

  it('rejeita roundingMode=CUSTOM sem roundingCustomCents', async () => {
    const result = await updateSettings(fd({
      energyCostPerKwh: '1',
      laborCostPerHour: '10',
      failureRatePercent: '0.1',
      marketplaceFeePercent: '0.2',
      taxPercent: '0.055',
      marketplaceFixedFee: '4',
      defaultMarkup: '2',
      annualMaintenancePercent: '0.10',
      annualUsageHours: '2000',
      ...baseCompositionAndRounding,
      roundingMode: 'CUSTOM',
    }))
    expect(result.success).toBe(false)
  })

  it('voltar de CUSTOM pra outro modo zera roundingCustomCents (não deixa valor órfão)', async () => {
    const custom = await updateSettings(fd({
      energyCostPerKwh: '1',
      laborCostPerHour: '10',
      failureRatePercent: '0.1',
      marketplaceFeePercent: '0.2',
      taxPercent: '0.055',
      marketplaceFixedFee: '4',
      defaultMarkup: '2',
      annualMaintenancePercent: '0.10',
      annualUsageHours: '2000',
      ...baseCompositionAndRounding,
      roundingMode: 'CUSTOM',
      roundingCustomCents: '77',
    }))
    expect(custom.success).toBe(true)

    const backToNone = await updateSettings(fd({
      energyCostPerKwh: '1',
      laborCostPerHour: '10',
      failureRatePercent: '0.1',
      marketplaceFeePercent: '0.2',
      taxPercent: '0.055',
      marketplaceFixedFee: '4',
      defaultMarkup: '2',
      annualMaintenancePercent: '0.10',
      annualUsageHours: '2000',
      ...baseCompositionAndRounding,
    }))
    expect(backToNone.success).toBe(true)

    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(settings.roundingMode).toBe('NONE')
    expect(settings.roundingCustomCents).toBeNull()
  })
})
