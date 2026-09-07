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
    }))
    expect(second.success).toBe(true)

    const count = await prisma.settings.count()
    expect(count).toBe(1)
    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
    expect(settings.energyCostPerKwh.toNumber()).toBeCloseTo(1.2)
  })
})
